import * as guildProfiles from '../../models/guildProfiles.model.js';
import * as guildModeration from '../../models/guildModeration.model.js';
import * as globalTimeline from '../../models/globalTimeline.model.js';
import * as aggregationQueue from '../../models/aggregationQueue.model.js';
import { VISIBILITY, JOB_TYPES } from '../../domain/catalog.js';

/**
 * Guild-local moderation record. The reason string stays inside the guild
 * layer; the global timeline only carries a neutral, MODERATOR_ONLY summary.
 */
export async function moderationAction(event, ctx) {
  const p = event.payload;
  const { action, created } = await guildModeration.addModerationAction({
    guildId: event.guildId,
    userId: event.userId,
    caseId: p.caseId ?? null,
    actionType: p.actionType,
    reason: p.reason ?? null,
    moderatorId: p.moderatorId ?? null,
    issuedAt: event.occurredAt,
    expiresAt: p.expiresAt ?? null,
    sourceEventId: event.eventId,
  });

  if (created) {
    if (p.actionType === 'BAN') {
      await guildProfiles.setMembershipStatus({
        guildId: event.guildId,
        userId: event.userId,
        status: 'BANNED',
        at: event.occurredAt,
      });
    } else if (p.actionType === 'UNBAN') {
      const profile = await guildProfiles.getGuildUser(event.guildId, event.userId);
      if (profile?.membership_status === 'BANNED') {
        await guildProfiles.setMembershipStatus({
          guildId: event.guildId,
          userId: event.userId,
          status: 'LEFT',
          at: event.occurredAt,
        });
      }
    }

    await globalTimeline.addTimelineEntry({
      userId: event.userId,
      occurredAt: event.occurredAt,
      eventType: event.type,
      guildId: event.guildId,
      summary: `Moderation action ${p.actionType} recorded in ${ctx.guild?.name ?? 'a participating community'}`,
      details: { actionType: p.actionType, caseId: action.case_id },
      visibility: VISIBILITY.MODERATOR_ONLY,
      sourceEventId: event.eventId,
    });

    await aggregationQueue.enqueue({
      jobType: JOB_TYPES.RECALC_REPUTATION,
      entityType: 'USER',
      entityId: event.userId,
      priority: 3,
    });
  }

  return { action, created };
}
