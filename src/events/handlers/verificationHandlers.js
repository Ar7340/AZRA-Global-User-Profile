import * as guildProfiles from '../../models/guildProfiles.model.js';
import * as guildVerification from '../../models/guildVerification.model.js';
import * as globalTimeline from '../../models/globalTimeline.model.js';
import * as aggregationQueue from '../../models/aggregationQueue.model.js';
import { VISIBILITY, JOB_TYPES } from '../../domain/catalog.js';

export async function verificationCompleted(event, ctx) {
  const { verification } = await guildVerification.setVerification({
    guildId: event.guildId,
    userId: event.userId,
    method: event.payload.method ?? 'MANUAL',
    status: 'VERIFIED',
    verifiedAt: event.occurredAt,
    verifiedByUserId: event.payload.verifiedByUserId ?? null,
    expiresAt: event.payload.expiresAt ?? null,
    sourceEventId: event.eventId,
  });
  await guildProfiles.upsertGuildUser({
    guildId: event.guildId,
    userId: event.userId,
    seenAt: event.occurredAt,
    verificationStatus: 'VERIFIED',
  });
  await globalTimeline.addTimelineEntry({
    userId: event.userId,
    occurredAt: event.occurredAt,
    eventType: event.type,
    guildId: event.guildId,
    summary: `Verified in ${ctx.guild?.name ?? 'a participating community'}`,
    visibility: VISIBILITY.GUILD,
    sourceEventId: event.eventId,
  });
  await aggregationQueue.enqueue({
    jobType: JOB_TYPES.RECALC_GLOBAL_VERIFICATION,
    entityType: 'USER',
    entityId: event.userId,
    priority: 4,
  });
  return { verification };
}

export async function verificationFailed(event) {
  const { verification } = await guildVerification.setVerification({
    guildId: event.guildId,
    userId: event.userId,
    method: event.payload.method ?? 'MANUAL',
    status: 'FAILED',
    verifiedAt: null,
    sourceEventId: event.eventId,
  });
  await guildProfiles.upsertGuildUser({
    guildId: event.guildId,
    userId: event.userId,
    seenAt: event.occurredAt,
    verificationStatus: 'UNVERIFIED',
  });
  return { verification };
}
