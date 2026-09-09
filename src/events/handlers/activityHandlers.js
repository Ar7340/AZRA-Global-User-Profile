import * as globalUsers from '../../models/globalUsers.model.js';
import * as guildProfiles from '../../models/guildProfiles.model.js';
import * as globalActivity from '../../models/globalActivity.model.js';
import * as guildActivity from '../../models/guildActivity.model.js';
import * as aggregationQueue from '../../models/aggregationQueue.model.js';
import { JOB_TYPES } from '../../domain/catalog.js';

/**
 * Shared handler for the four activity event kinds (the validator stamps
 * event.activityKind). Writes are layered: identity touch → guild touch →
 * global counters → daily bucket → guild counters → aggregation job.
 */
export async function activity(event) {
  const raw = event.payload.amount ?? event.payload.minutes ?? 1;
  const amount = Math.max(0, Number(raw) || 0);

  await globalUsers.upsertUser({
    userId: event.userId,
    username: event.payload.username ?? null,
    seenAt: event.occurredAt,
  });
  await guildProfiles.upsertGuildUser({
    guildId: event.guildId,
    userId: event.userId,
    seenAt: event.occurredAt,
    nickname: event.payload.nickname ?? null,
  });
  const { row: globalTotals } = await globalActivity.incrementActivity({
    userId: event.userId,
    kind: event.activityKind,
    amount,
    at: event.occurredAt,
  });
  await globalActivity.recordDailyActivity({
    userId: event.userId,
    kind: event.activityKind,
    amount,
    at: event.occurredAt,
  });
  await guildActivity.incrementActivity({
    guildId: event.guildId,
    userId: event.userId,
    kind: event.activityKind,
    amount,
    at: event.occurredAt,
  });
  await aggregationQueue.enqueue({
    jobType: JOB_TYPES.RECALC_CONTRIBUTING_GUILDS,
    entityType: 'USER',
    entityId: event.userId,
    priority: 7,
  });
  return { amount, globalTotals };
}

export const activityMessage = activity;
export const activityVoice = activity;
export const activityReaction = activity;
export const activityCommand = activity;
