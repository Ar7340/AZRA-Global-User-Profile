import { withTransaction, getStore } from '../db/index.js';
import { TABLE_NAMES } from '../db/json/schema.js';
import { nowIso, toIso } from '../utils/dates.js';
import { NotFoundError } from '../utils/errors.js';
import { paginateDesc } from '../utils/paginate.js';

const T = TABLE_NAMES.PROFILE_DATA_SOURCES;
const keyOf = (row) => `${row.recorded_at ?? ''}#${row.event_id}`;

/**
 * Provenance ledger: one row per accepted event answering "where did this
 * piece of information come from?" — guild, system, admin, visibility and
 * authorization state included. AZRA can always explain its data.
 */
export async function recordSource({
  eventId, sourceGuildId = null, sourceType, sourceRef = null,
  visibility, authorizationStatus = 'AUTHORIZED', recordedAt,
}) {
  return withTransaction((tx) => {
    const table = tx.table(T);
    const existing = table.get(eventId);
    if (existing) return { created: false, source: existing };

    const source = {
      event_id: eventId,
      source_guild_id: sourceGuildId,
      source_type: sourceType,
      source_ref: sourceRef != null ? String(sourceRef).slice(0, 190) : null,
      visibility,
      authorization_status: authorizationStatus,
      recorded_at: toIso(recordedAt) ?? nowIso(),
      created_at: nowIso(),
    };
    table.insert(source);
    return { created: true, source };
  });
}

export async function getSource(eventId) {
  return getStore().table(T).get(eventId) ?? null;
}

export async function listByGuild(guildId, { limit = 50, before = null } = {}) {
  const rows = [...getStore().table(T).filter((r) => r.source_guild_id === guildId)];
  return paginateDesc(rows, { keyOf, limit, before });
}

export async function setAuthorization(eventId, status, { updatedByUserId = null } = {}) {
  return withTransaction((tx) => {
    const table = tx.table(T);
    if (!table.has(eventId)) {
      throw new NotFoundError(`Data source ${eventId} not found`);
    }
    return table.update(eventId, {
      authorization_status: status,
      updated_by_user_id: updatedByUserId,
    });
  });
}

export async function countByGuild(guildId) {
  return getStore().table(T).count((r) => r.source_guild_id === guildId);
}

export async function countByAuthorization(status) {
  return getStore().table(T).count((r) => r.authorization_status === status);
}
