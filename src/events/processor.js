import { getStore } from '../db/index.js';
import { env } from '../config/env.js';
import { validateEvent } from './validators.js';
import { evaluate } from './permissionGate.js';
import { dispatch } from './router.js';
import * as processedEvents from '../models/processedEvents.model.js';
import * as dataSources from '../models/dataSources.model.js';
import { invalidateUserCache, invalidateGuildCache } from '../cache/cache.js';
import { logger } from '../utils/logger.js';
import { StorageError } from '../utils/errors.js';

const log = logger.child('processor');

/**
 * AZRA Event Processor — the single ingestion entry point.
 *
 *   Discord Event → validate → claim idempotency slot → permission /
 *   data-sharing check → transactional writes (global + guild + provenance
 *   source) → mark processed → cache invalidation.
 *
 * Returns a structured outcome instead of throwing for expected paths:
 *   { status: 'processed' | 'skipped' | 'duplicate', ... }
 * Validation errors throw ValidationError; handler failures throw
 * StorageError after being recorded in the ledger for retry.
 */
export async function ingestEvent(rawEvent) {
  // 1. Validation.
  let event;
  try {
    event = validateEvent(rawEvent);
  } catch (err) {
    const candidateId = typeof rawEvent?.eventId === 'string' ? rawEvent.eventId : null;
    if (candidateId && candidateId.length > 0 && candidateId.length <= 128) {
      await processedEvents.markRejected(candidateId, err.message, {
        eventType: typeof rawEvent?.type === 'string' ? rawEvent.type : null,
        guildId: typeof rawEvent?.guildId === 'string' ? rawEvent.guildId : null,
      });
    }
    log.warn('event rejected at validation', { error: err.message });
    throw err;
  }

  // 2. Idempotency claim — replays and exhausted retries are no-ops.
  const claim = await processedEvents.claimEvent(
    {
      eventId: event.eventId,
      eventType: event.type,
      guildId: event.guildId,
      userId: event.userId,
    },
    { maxAttempts: env.events.maxAttempts },
  );
  if (!claim.claimed) {
    log.debug('duplicate event ignored', { eventId: event.eventId, status: claim.status });
    return { status: 'duplicate', eventId: event.eventId, previousStatus: claim.status };
  }

  // 3. Permission / data-sharing check.
  const decision = await evaluate(event);
  if (!decision.allowed) {
    await processedEvents.markSkipped(event.eventId, decision.reason);
    log.info('event skipped by permission gate', {
      eventId: event.eventId,
      type: event.type,
      reason: decision.reason,
    });
    return { status: 'skipped', reason: decision.reason, eventId: event.eventId };
  }

  // 4. Transactional writes: handler + provenance source + ledger.
  try {
    await getStore().withTransaction(async () => {
      await dispatch(event, decision);
      await dataSources.recordSource({
        eventId: event.eventId,
        sourceGuildId: event.guildId,
        sourceType: decision.sourceType,
        sourceRef: event.sourceRef,
        visibility: decision.visibility,
        authorizationStatus: decision.authorizationStatus,
        recordedAt: event.occurredAt,
      });
      await processedEvents.markProcessed(event.eventId);
    });
  } catch (err) {
    await processedEvents.markFailed(event.eventId, err, { maxAttempts: env.events.maxAttempts });
    log.error('event failed during processing', {
      eventId: event.eventId,
      type: event.type,
      error: err.message,
    });
    throw new StorageError(
      `Event ${event.eventId} failed to process: ${err.message}`,
      { cause: err, details: { eventId: event.eventId } },
    );
  }

  // 5. Post-commit cache invalidation.
  invalidateUserCache(event.userId);
  invalidateGuildCache(event.guildId);

  log.info('event processed', { eventId: event.eventId, type: event.type });
  return { status: 'processed', eventId: event.eventId, visibility: decision.visibility };
}
