import { env } from '../config/env.js';
import * as aggregationQueue from '../models/aggregationQueue.model.js';
import * as guildActivity from '../models/guildActivity.model.js';
import * as globalActivity from '../models/globalActivity.model.js';
import * as guilds from '../models/guilds.model.js';
import * as dataPermissions from '../models/dataPermissions.model.js';
import * as guildModeration from '../models/guildModeration.model.js';
import * as globalBadges from '../models/globalBadges.model.js';
import * as globalReputation from '../models/globalReputation.model.js';
import * as guildVerification from '../models/guildVerification.model.js';
import * as globalVerification from '../models/globalVerification.model.js';
import * as guildProfiles from '../models/guildProfiles.model.js';
import { JOB_TYPES } from '../domain/catalog.js';
import { logger } from '../utils/logger.js';
import { minIso, maxIso } from '../utils/dates.js';

const log = logger.child('aggregation');

/** Every aggregate below is computed ONLY from participating guilds whose
 *  permission row allows the relevant category — one server's data can never
 *  silently become global truth. */

export const REPUTATION_WEIGHTS = {
  perVerifiedGuild: 15, maxVerifiedGuilds: 5,
  perBadge: 10, maxBadges: 4,
  per500Messages: 5, maxMessageBonusSteps: 5,
  banPenalty: 40, maxBanCount: 3,
  kickPenalty: 20, maxKickCount: 3,
  timeoutPenalty: 5, maxTimeoutCount: 5,
  warnPenalty: 3, maxWarnCount: 10,
  perPositiveSignal: 2, perNegativeSignal: 2,
};

export const REPUTATION_THRESHOLDS = { FLAGGED: -50, EXEMPLARY: 150, TRUSTED: 75, ESTABLISHED: 15 };

export function computeReputationLevel(score) {
  if (score <= REPUTATION_THRESHOLDS.FLAGGED) return 'FLAGGED';
  if (score >= REPUTATION_THRESHOLDS.EXEMPLARY) return 'EXEMPLARY';
  if (score >= REPUTATION_THRESHOLDS.TRUSTED) return 'TRUSTED';
  if (score >= REPUTATION_THRESHOLDS.ESTABLISHED) return 'ESTABLISHED';
  return 'NEW';
}

function intersectionSet(ids, allowedIds) {
  const allowed = new Set(allowedIds);
  return new Set(ids.filter((id) => allowed.has(id)));
}

/** Guild set that is participating AND allows the given category. */
async function authorizedGuildSet(category) {
  const [participating, allowed] = await Promise.all([
    guilds.listParticipatingGuildIds(),
    dataPermissions.listAllowedGuildIds(category),
  ]);
  return intersectionSet(participating, allowed);
}

/** Verified guild verifications scoped to authorized sources. Shared by the
 *  reputation and verification aggregates so neither depends on the other's
 *  freshness in the queue. */
export async function listAuthorizedVerifiedGuilds(userId) {
  const allowed = await authorizedGuildSet('VERIFICATION');
  return (await guildVerification.listUserVerifications(userId))
    .filter((r) => r.status === 'VERIFIED' && allowed.has(r.guild_id));
}

/** Rebuilds global activity totals + contributing-guild count for a user. */
export async function rebuildGlobalActivity(userId) {
  const allowed = await authorizedGuildSet('ACTIVITY');

  const rows = (await guildActivity.listUserGuildActivity(userId))
    .filter((r) => allowed.has(r.guild_id) && guildActivity.hasAnyActivity(r));

  const totals = {
    messagesSeen: 0, reactionsAdded: 0, voiceMinutes: 0, commandsUsed: 0,
    firstActiveAt: null, lastActiveAt: null,
  };
  for (const row of rows) {
    totals.messagesSeen += row.messages_seen ?? 0;
    totals.reactionsAdded += row.reactions_added ?? 0;
    totals.voiceMinutes += row.voice_minutes ?? 0;
    totals.commandsUsed += row.commands_used ?? 0;
    totals.firstActiveAt = minIso(totals.firstActiveAt, row.first_active_at);
    totals.lastActiveAt = maxIso(totals.lastActiveAt, row.last_active_at);
  }
  const activeDays = await globalActivity.countDailyBuckets(userId);

  return globalActivity.setAggregates(userId, {
    ...totals,
    contributingGuilds: rows.length,
    activeDays,
  });
}

/** Moderation counts across participating guilds that allow MODERATION sharing. */
export async function getScopedModerationCounts(userId) {
  const allowed = await authorizedGuildSet('MODERATION');

  const counts = {};
  const { items } = await guildModeration.listUserActionsAcrossGuilds(userId, { limit: 10_000 });
  for (const action of items) {
    if (allowed.has(action.guild_id)) {
      counts[action.action_type] = (counts[action.action_type] ?? 0) + 1;
    }
  }
  return counts;
}

/** Deterministic, documented reputation formula. */
export async function recalcReputation(userId) {
  const verifiedRows = await listAuthorizedVerifiedGuilds(userId);
  const verifiedGuilds = verifiedRows.length;
  const activeBadges = await globalBadges.countActiveBadges(userId);
  const counts = await getScopedModerationCounts(userId);
  const totals = await globalActivity.getTotals(userId);
  const messagesSeen = totals?.messages_seen ?? 0;
  const rep = await globalReputation.getReputation(userId);
  const positiveSignals = rep?.positive_signals ?? 0;
  const negativeSignals = rep?.negative_signals ?? 0;

  const w = REPUTATION_WEIGHTS;
  let score = 0;
  score += Math.min(verifiedGuilds, w.maxVerifiedGuilds) * w.perVerifiedGuild;
  score += Math.min(activeBadges, w.maxBadges) * w.perBadge;
  score += Math.min(Math.floor(messagesSeen / 500), w.maxMessageBonusSteps) * w.per500Messages;
  score -= Math.min(counts.BAN ?? 0, w.maxBanCount) * w.banPenalty;
  score -= Math.min(counts.KICK ?? 0, w.maxKickCount) * w.kickPenalty;
  score -= Math.min(counts.TIMEOUT ?? 0, w.maxTimeoutCount) * w.timeoutPenalty;
  score -= Math.min(counts.WARN ?? 0, w.maxWarnCount) * w.warnPenalty;
  score += positiveSignals * w.perPositiveSignal;
  score -= negativeSignals * w.perNegativeSignal;

  return globalReputation.setReputation(userId, {
    score,
    level: computeReputationLevel(score),
    breakdown: {
      verifiedGuilds, activeBadges, messagesSeen,
      ...counts, positiveSignals, negativeSignals,
    },
  });
}

/** Recomputes cross-guild verification from authorized guild verifications. */
export async function recalcGlobalVerification(userId) {
  const verified = await listAuthorizedVerifiedGuilds(userId);

  let verifiedAt = null;
  let lastVerifiedAt = null;
  for (const row of verified) {
    verifiedAt = minIso(verifiedAt, row.verified_at);
    lastVerifiedAt = maxIso(lastVerifiedAt, row.verified_at);
  }
  const confirmingGuilds = verified.length;

  return globalVerification.setVerificationState(userId, {
    status: confirmingGuilds > 0 ? 'VERIFIED' : 'UNKNOWN',
    highestLevel: confirmingGuilds >= 2 ? 'CROSS_GUILD' : confirmingGuilds === 1 ? 'GUILD' : 'NONE',
    verifiedAt,
    lastVerifiedAt,
    confirmingGuilds,
  });
}

/** Re-enqueues per-user recalculation for a guild's members (batched). */
export async function rebuildGuildAggregates(guildId, { maxUsers = 1_000 } = {}) {
  const { items } = await guildProfiles.listGuildUsers(guildId, { limit: maxUsers, status: 'MEMBER' });
  let enqueued = 0;
  for (const profile of items) {
    const { queued } = await aggregationQueue.enqueue({
      jobType: JOB_TYPES.RECALC_CONTRIBUTING_GUILDS,
      entityType: 'USER',
      entityId: profile.user_id,
      priority: 8,
    });
    if (queued) enqueued += 1;
  }
  return { usersConsidered: items.length, jobsEnqueued: enqueued };
}

async function runJob(job) {
  switch (job.job_type) {
    case JOB_TYPES.RECALC_CONTRIBUTING_GUILDS:
      return rebuildGlobalActivity(job.entity_id);
    case JOB_TYPES.RECALC_REPUTATION:
      return recalcReputation(job.entity_id);
    case JOB_TYPES.RECALC_GLOBAL_VERIFICATION:
      return recalcGlobalVerification(job.entity_id);
    case JOB_TYPES.REBUILD_GUILD_AGGREGATES:
      return rebuildGuildAggregates(job.entity_id);
    default:
      throw new Error(`Unknown aggregation job type "${job.job_type}"`);
  }
}

/** Drains up to batchSize jobs; safe to call manually (tests, seed, cron). */
export async function runAggregationPass({ batchSize, workerId = 'azra-worker' } = {}) {
  const jobs = await aggregationQueue.claimBatch({
    limit: batchSize ?? env.aggregation.batchSize,
    workerId,
  });
  let ok = 0;
  let failed = 0;
  for (const job of jobs) {
    try {
      await runJob(job);
      await aggregationQueue.complete(job.id);
      ok += 1;
    } catch (err) {
      await aggregationQueue.fail(job.id, err);
      failed += 1;
      log.warn('aggregation job failed', {
        jobType: job.job_type,
        entityId: job.entity_id,
        error: err.message,
      });
    }
  }
  return { claimed: jobs.length, ok, failed };
}

let workerTimer = null;

export function startAggregationWorker({ intervalMs, batchSize } = {}) {
  if (workerTimer) return { stop: stopAggregationWorker };
  const interval = intervalMs ?? env.aggregation.pollIntervalMs;
  workerTimer = setInterval(() => {
    runAggregationPass({ batchSize }).catch((err) => {
      log.error('aggregation pass crashed', { error: err.message });
    });
  }, interval);
  workerTimer.unref?.();
  log.debug('aggregation worker started', { intervalMs: interval });
  return { stop: stopAggregationWorker };
}

export function stopAggregationWorker() {
  if (workerTimer) {
    clearInterval(workerTimer);
    workerTimer = null;
  }
}

export function isWorkerRunning() {
  return workerTimer != null;
}

