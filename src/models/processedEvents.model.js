import { withTransaction, getStore } from '../db/index.js';
import { TABLE_NAMES } from '../db/json/schema.js';
import { nowIso } from '../utils/dates.js';
import { paginateDesc } from '../utils/paginate.js';

const T = TABLE_NAMES.PROCESSED_EVENTS;

/**
 * Idempotency ledger. claimEvent() is the gate every ingested event passes:
 * - first sighting → row inserted (RECEIVED), event claimed
 * - retryable failure (RECEIVED under the attempt budget) → re-claimed
 * - anything else (PROCESSED / SKIPPED / REJECTED / FAILED / exhausted) →
 *   the event is a no-op duplicate.
 */
export async function claimEvent({ eventId, eventType, guildId = null, userId = null }, { maxAttempts = 3 } = {}) {
  return withTransaction((tx) => {
    const table = tx.table(T);
    const existing = table.get(eventId);

    if (!existing) {
      table.insert({
        event_id: eventId,
        event_type: eventType,
        guild_id: guildId,
        user_id: userId,
        status: 'RECEIVED',
        attempts: 1,
        last_error: null,
        processed_at: null,
        created_at: nowIso(),
      });
      return { claimed: true, attempts: 1, retry: false };
    }

    if (existing.status === 'RECEIVED' && existing.attempts < maxAttempts) {
      table.update(eventId, { attempts: existing.attempts + 1 });
      return { claimed: true, attempts: existing.attempts + 1, retry: true };
    }

    return { claimed: false, status: existing.status };
  });
}

export async function markProcessed(eventId) {
  return withTransaction((tx) => {
    const table = tx.table(T);
    if (!table.has(eventId)) return null;
    return table.update(eventId, { status: 'PROCESSED', processed_at: nowIso() });
  });
}

export async function markSkipped(eventId, reason) {
  return withTransaction((tx) => {
    const table = tx.table(T);
    if (!table.has(eventId)) return null;
    return table.update(eventId, {
      status: 'SKIPPED',
      last_error: String(reason).slice(0, 512),
      processed_at: nowIso(),
    });
  });
}

/** Records an invalid event; upserts so validation failures before claiming
 *  are still visible in the ledger. */
export async function markRejected(eventId, reason, { eventType = null, guildId = null } = {}) {
  return withTransaction((tx) => {
    const table = tx.table(T);
    const existing = table.get(eventId);
    if (existing) {
      return table.update(eventId, {
        status: 'REJECTED',
        last_error: String(reason).slice(0, 512),
        processed_at: nowIso(),
      });
    }
    const row = {
      event_id: eventId,
      event_type: eventType,
      guild_id: guildId,
      user_id: null,
      status: 'REJECTED',
      attempts: 1,
      last_error: String(reason).slice(0, 512),
      processed_at: nowIso(),
      created_at: nowIso(),
    };
    table.insert(row);
    return row;
  });
}

export async function markFailed(eventId, error, { maxAttempts = 3 } = {}) {
  return withTransaction((tx) => {
    const table = tx.table(T);
    const existing = table.get(eventId);
    if (!existing) return null;
    const exhausted = existing.attempts >= maxAttempts;
    return table.update(eventId, {
      status: exhausted ? 'FAILED' : 'RECEIVED',
      last_error: String(error?.message ?? error).slice(0, 512),
    });
  });
}

export async function getEvent(eventId) {
  return getStore().table(T).get(eventId) ?? null;
}

export async function countByStatus(status) {
  return getStore().table(T).count((r) => r.status === status);
}

export async function listRecent({ status = null, limit = 50 } = {}) {
  const rows = getStore().table(T).toArray();
  const filtered = status ? rows.filter((r) => r.status === status) : rows;
  return paginateDesc(filtered, {
    keyOf: (r) => `${r.created_at ?? ''}#${r.event_id}`,
    limit,
  });
}
