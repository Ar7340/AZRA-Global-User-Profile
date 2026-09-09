import * as globalBadges from '../../models/globalBadges.model.js';
import * as globalAchievements from '../../models/globalAchievements.model.js';
import * as globalReputation from '../../models/globalReputation.model.js';
import * as globalTimeline from '../../models/globalTimeline.model.js';
import * as aggregationQueue from '../../models/aggregationQueue.model.js';
import { VISIBILITY, JOB_TYPES } from '../../domain/catalog.js';

export async function badgeAwarded(event) {
  const { created, badge } = await globalBadges.awardBadge({
    userId: event.userId,
    badgeKey: event.payload.badgeKey,
    awardedByGuildId: event.guildId,
    awardedByUserId: event.payload.awardedByUserId ?? null,
    awardedAt: event.occurredAt,
    sourceEventId: event.eventId,
  });
  if (created) {
    await globalTimeline.addTimelineEntry({
      userId: event.userId,
      occurredAt: event.occurredAt,
      eventType: event.type,
      guildId: event.guildId,
      summary: `Earned the ${event.payload.badgeKey} badge`,
      visibility: VISIBILITY.GLOBAL,
      sourceEventId: event.eventId,
    });
  }
  return { created, badge };
}

export async function badgeRevoked(event) {
  return globalBadges.revokeBadge(event.userId, event.payload.badgeKey, {
    reason: event.payload.reason ?? null,
    revokedAt: event.occurredAt,
  });
}

export async function achievementUnlocked(event) {
  const { created, achievement } = await globalAchievements.unlockAchievement({
    userId: event.userId,
    achievementKey: event.payload.achievementKey,
    tier: event.payload.tier ?? 1,
    achievedAt: event.occurredAt,
    sourceGuildId: event.guildId,
    sourceEventId: event.eventId,
  });
  if (created) {
    await globalTimeline.addTimelineEntry({
      userId: event.userId,
      occurredAt: event.occurredAt,
      eventType: event.type,
      guildId: event.guildId,
      summary: `Unlocked achievement ${event.payload.achievementKey}`,
      visibility: VISIBILITY.GLOBAL,
      sourceEventId: event.eventId,
    });
  }
  return { created, achievement };
}

export async function reputationSignal(event) {
  const row = await globalReputation.applySignal(event.userId, {
    direction: event.payload.direction,
    amount: event.payload.amount ?? 1,
  });
  await aggregationQueue.enqueue({
    jobType: JOB_TYPES.RECALC_REPUTATION,
    entityType: 'USER',
    entityId: event.userId,
    priority: 3,
  });
  return { reputation: row };
}
