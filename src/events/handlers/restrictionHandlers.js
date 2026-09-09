import * as globalRestrictions from '../../models/globalRestrictions.model.js';
import * as globalTimeline from '../../models/globalTimeline.model.js';
import { VISIBILITY } from '../../domain/catalog.js';

/** Platform-level restrictions — GLOBAL_ADMIN source enforced by the gate. */
export async function restrictionApplied(event) {
  const { created, restriction } = await globalRestrictions.applyRestriction({
    userId: event.userId,
    restrictionType: event.payload.restrictionType,
    reason: event.payload.reason ?? null,
    sourceGuildId: null,
    issuedByUserId: event.payload.issuedByUserId ?? null,
    startsAt: event.occurredAt,
    expiresAt: event.payload.expiresAt ?? null,
    sourceEventId: event.eventId,
  });
  if (created) {
    await globalTimeline.addTimelineEntry({
      userId: event.userId,
      occurredAt: event.occurredAt,
      eventType: event.type,
      guildId: null,
      summary: `Global restriction applied: ${event.payload.restrictionType}`,
      visibility: VISIBILITY.GLOBAL,
      sourceEventId: event.eventId,
    });
  }
  return { created, restriction };
}

export async function restrictionLifted(event) {
  const { lifted, restriction } = await globalRestrictions.liftRestriction(
    event.userId,
    event.payload.restrictionType,
    { liftedByUserId: event.payload.issuedByUserId ?? null, at: event.occurredAt },
  );
  if (lifted) {
    await globalTimeline.addTimelineEntry({
      userId: event.userId,
      occurredAt: event.occurredAt,
      eventType: event.type,
      guildId: null,
      summary: `Global restriction lifted: ${event.payload.restrictionType}`,
      visibility: VISIBILITY.GLOBAL,
      sourceEventId: event.eventId,
    });
  }
  return { lifted, restriction };
}
