import * as globalUsers from '../models/globalUsers.model.js';
import * as globalVerification from '../models/globalVerification.model.js';
import * as globalBadges from '../models/globalBadges.model.js';
import * as globalAchievements from '../models/globalAchievements.model.js';
import * as globalActivity from '../models/globalActivity.model.js';
import * as globalReputation from '../models/globalReputation.model.js';
import * as globalRestrictions from '../models/globalRestrictions.model.js';
import * as globalTimeline from '../models/globalTimeline.model.js';
import * as guilds from '../models/guilds.model.js';
import * as guildProfiles from '../models/guildProfiles.model.js';
import * as guildActivity from '../models/guildActivity.model.js';
import * as guildModeration from '../models/guildModeration.model.js';
import * as guildRoles from '../models/guildRoles.model.js';
import * as guildVerification from '../models/guildVerification.model.js';
import * as accessLogs from '../models/accessLogs.model.js';
import { getUserDataCoverage, coverageNote, describeMetric } from './coverage.js';
import { getScopedModerationCounts } from './aggregationService.js';
import { cache, CACHE_KEYS } from '../cache/cache.js';
import { VISIBILITY_RANK } from '../domain/catalog.js';
import { NotFoundError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

const log = logger.child('profile');

function scopeRank(scope) {
  return { PUBLIC: 0, MODERATOR: 1, ADMIN: 2 }[scope] ?? 0;
}

function minTimelineRankFor(scope) {
  // PUBLIC → only GLOBAL entries; MODERATOR → + GUILD/MODERATOR_ONLY; ADMIN → all.
  const rank = scopeRank(scope);
  if (rank >= 2) return VISIBILITY_RANK.PRIVATE;
  if (rank === 1) return VISIBILITY_RANK.MODERATOR_ONLY;
  return VISIBILITY_RANK.GLOBAL;
}

function hasRecordedActivity(totals) {
  if (!totals) return false;
  return (
    (totals.messages_seen ?? 0) > 0
    || (totals.reactions_added ?? 0) > 0
    || (totals.voice_minutes ?? 0) > 0
    || (totals.commands_used ?? 0) > 0
  );
}

async function logAccessSafe(entry) {
  try {
    await accessLogs.logAccess(entry);
  } catch (err) {
    log.warn('access log write failed', { error: err.message });
  }
}

/**
 * Builds the global profile summary. Always attaches coverage metadata and
 * never loads a user's full history — bounded lists only. Private layers
 * (moderation detail, restrictions, reputation score) require elevated scope.
 */
export async function getGlobalProfileSummary(userId, {
  viewerId = null, viewerScope = 'PUBLIC', useCache = true,
} = {}) {
  const rank = scopeRank(viewerScope);
  const cacheKey = `${CACHE_KEYS.userSummary(userId)}:${viewerScope}`;

  const load = async () => {
    const user = await globalUsers.getUser(userId);
    if (!user) throw new NotFoundError(`Global user ${userId} not found`);

    const coverage = await getUserDataCoverage(userId);
    const summary = {
      user: {
        userId: user.user_id,
        username: user.username,
        globalName: user.global_name,
        avatarHash: user.avatar_hash,
        isBot: user.is_bot,
        accountCreatedAt: user.account_created_at,
        firstSeenAt: user.first_seen_at,
        lastSeenAt: user.last_seen_at,
        profileCreatedAt: user.created_at,
        profileUpdatedAt: user.updated_at,
      },
      coverage: { ...coverage, note: coverageNote(coverage) },
      verification: null,
      badges: null,
      achievements: null,
      activity: null,
      reputation: null,
      moderation: null,
      restrictions: null,
      timeline: [],
      generatedAt: new Date().toISOString(),
    };

    const verification = await globalVerification.getVerification(userId);
    if (verification) {
      summary.verification = {
        status: verification.status,
        highestLevel: verification.highest_level,
        confirmingGuilds: verification.confirming_guilds,
        verifiedAt: verification.verified_at,
        lastVerifiedAt: verification.last_verified_at,
      };
    }

    const badges = await globalBadges.listBadges(userId);
    summary.badges = {
      count: badges.length,
      items: badges.slice(0, 10).map((b) => ({
        key: b.badge_key,
        awardedAt: b.awarded_at,
        awardedByGuildId: b.awarded_by_guild_id,
      })),
    };

    const achievements = await globalAchievements.listAchievements(userId, { limit: 10 });
    summary.achievements = {
      count: await globalAchievements.countAchievements(userId),
      items: achievements.items.map((a) => ({
        key: a.achievement_key,
        tier: a.tier,
        achievedAt: a.achieved_at,
      })),
    };

    const totals = await globalActivity.getTotals(userId);
    if (hasRecordedActivity(totals)) {
      summary.activity = {
        hasData: true,
        contributingGuilds: totals.contributing_guilds,
        totals: {
          messagesSeen: totals.messages_seen,
          reactionsAdded: totals.reactions_added,
          voiceMinutes: totals.voice_minutes,
          commandsUsed: totals.commands_used,
          activeDays: totals.active_days,
        },
        lines: {
          messages: describeMetric({ label: 'message', count: totals.messages_seen, coverage }),
          reactions: describeMetric({ label: 'reaction', count: totals.reactions_added, coverage }),
          voiceMinutes: describeMetric({ label: 'voice minute', count: totals.voice_minutes, coverage }),
          commands: describeMetric({ label: 'command use', plural: 'command uses', count: totals.commands_used, coverage }),
        },
        firstActiveAt: totals.first_active_at,
        lastActiveAt: totals.last_active_at,
        recentDays: (await globalActivity.getRecentDaily(userId, { limit: 7 })).map((d) => ({
          date: d.activity_date,
          messagesSeen: d.messages_seen,
          reactionsAdded: d.reactions_added,
          voiceMinutes: d.voice_minutes,
          commandsUsed: d.commands_used,
        })),
      };
    } else {
      summary.activity = { hasData: false, note: 'No AZRA activity data available yet.' };
    }

    const rep = await globalReputation.getReputation(userId);
    summary.reputation = rank >= 1
      ? {
          level: rep?.level ?? 'NEW',
          score: rep?.reputation_score ?? null,
          positiveSignals: rep?.positive_signals ?? 0,
          negativeSignals: rep?.negative_signals ?? 0,
        }
      : { level: rep?.level ?? 'NEW' };

    if (rank >= 1) {
      const counts = await getScopedModerationCounts(userId);
      summary.moderation = {
        counts,
        lines: {
          bans: describeMetric({ label: 'ban', count: counts.BAN ?? 0, coverage }),
          kicks: describeMetric({ label: 'kick', count: counts.KICK ?? 0, coverage }),
          timeouts: describeMetric({ label: 'timeout', count: counts.TIMEOUT ?? 0, coverage }),
          warns: describeMetric({ label: 'warning', count: counts.WARN ?? 0, coverage }),
        },
        recent: (await guildModeration.listUserActionsAcrossGuilds(userId, { limit: 5 }))
          .items.map((a) => ({
            guildId: a.guild_id,
            actionType: a.action_type,
            reason: a.reason,
            caseId: a.case_id,
            issuedAt: a.issued_at,
          })),
      };
      summary.restrictions = (await globalRestrictions.getActiveRestrictions(userId)).map((r) => ({
        type: r.restriction_type,
        reason: r.reason,
        startsAt: r.starts_at,
        expiresAt: r.expires_at,
        status: r.status,
      }));
    }

    summary.timeline = (await globalTimeline.getTimeline(userId, {
      limit: 10,
      minVisibilityRank: minTimelineRankFor(viewerScope),
    })).items.map((t) => ({
      occurredAt: t.occurred_at,
      eventType: t.event_type,
      guildId: t.guild_id,
      summary: t.summary,
      visibility: t.visibility,
    }));

    return summary;
  };

  const result = useCache ? await cache.wrap(cacheKey, load, { ttlMs: 10_000 }) : await load();

  await logAccessSafe({
    viewerId,
    targetUserId: userId,
    accessScope: viewerScope,
    fieldsAccessed: Object.keys(result).filter((k) => result[k] != null),
    outcome: 'ALLOWED',
  });

  return result;
}

/** Guild-scoped profile (guild layer only — no cross-guild aggregates). */
export async function getGuildProfileSummary(guildId, userId, {
  viewerId = null, viewerScope = 'PUBLIC', useCache = true,
} = {}) {
  const rank = scopeRank(viewerScope);
  const cacheKey = `${CACHE_KEYS.guildUserSummary(guildId, userId)}:${viewerScope}`;

  const load = async () => {
    const guild = await guilds.requireGuild(guildId);
    const profile = await guildProfiles.getGuildUser(guildId, userId);
    if (!profile) {
      throw new NotFoundError(`No guild profile for user ${userId} in guild ${guildId}`);
    }
    const activity = await guildActivity.getTotals(guildId, userId);
    const roles = await guildRoles.listActiveRoles(guildId, userId);
    const verification = await guildVerification.getVerification(guildId, userId);
    const moderation = rank >= 1
      ? (await guildModeration.listGuildUserActions(guildId, userId, { limit: 10 })).items
      : null;

    return {
      guild: {
        guildId: guild.guild_id,
        name: guild.name,
        isParticipating: guild.is_participating,
      },
      profile: {
        firstSeenAt: profile.first_seen_at,
        lastSeenAt: profile.last_seen_at,
        joinedAt: profile.joined_at,
        leftAt: profile.left_at,
        membershipStatus: profile.membership_status,
        nickname: profile.nickname,
        verificationStatus: profile.verification_status,
        sourceStatus: profile.source_status,
      },
      activity: activity
        ? {
            messagesSeen: activity.messages_seen,
            reactionsAdded: activity.reactions_added,
            voiceMinutes: activity.voice_minutes,
            commandsUsed: activity.commands_used,
            firstActiveAt: activity.first_active_at,
            lastActiveAt: activity.last_active_at,
          }
        : null,
      roles: roles.map((r) => ({
        roleId: r.role_id,
        roleName: r.role_name,
        position: r.role_position,
      })),
      verification: verification
        ? {
            method: verification.method,
            status: verification.status,
            verifiedAt: verification.verified_at,
          }
        : null,
      moderation,
      generatedAt: new Date().toISOString(),
    };
  };

  const result = useCache ? await cache.wrap(cacheKey, load, { ttlMs: 10_000 }) : await load();

  await logAccessSafe({
    viewerId,
    targetUserId: userId,
    guildId,
    accessScope: viewerScope,
    outcome: 'ALLOWED',
  });

  return result;
}


