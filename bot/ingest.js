import { ingestEvent } from '../src/events/processor.js';
import { logger } from '../src/utils/logger.js';

const log = logger.child('discord');

/**
 * Safe ingestion wrapper for Discord-side listeners. Never throws — a failed
 * ingestion must not crash the gateway connection. Validation problems are
 * logged at debug (bot bugs), infrastructure problems at error.
 */
export async function ingest(type, payload, {
  eventId, guildId = null, userId = null, sourceType, occurredAt,
} = {}) {
  try {
    const result = await ingestEvent({
      eventId,
      type,
      payload,
      guildId,
      userId,
      sourceType,
      occurredAt,
    });
    if (result.status === 'skipped') {
      log.debug('event skipped by gate', { type, eventId, reason: result.reason });
    }
    return result;
  } catch (err) {
    if (err?.name === 'ValidationError') {
      log.debug('event rejected by validation', { type, eventId, error: err.message });
    } else {
      log.error('event ingestion failed', { type, eventId, error: err.message });
    }
    return { status: 'error', error: err?.message ?? String(err) };
  }
}
