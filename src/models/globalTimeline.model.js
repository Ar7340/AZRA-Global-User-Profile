import { withTransaction, getStore } from '../db/index.js';
import { TABLE_NAMES } from '../db/json/schema.js';
import { nowIso, toIso } from '../utils/dates.js';
import { VISIBILITY_RANK } from '../domain/catalog.js';
import { paginateDesc } from '../utils/paginate.js';

const T = TABLE_NAMES.GLOBAL_TIMELINE;

/**
 * Appends a community-history entry. Callers must set visibility explicitly:
 * sensitive summaries (moderation) stay MODERATOR_ONLY, cross-guild highlights
 * go GLOBAL. Entry content is stored verbatim — viewer filtering happens on
 * read via maxVisibilityRank.
 */
export async function addTimelineEntry({
  userId, occurredAt, eventType, guildId = null, summary,
  details = null, visibility = 'GUILD', sourceEventId = null,
}) {
  return withTransaction((tx) => {
    const table = tx.table(T);
    const entry = {
      id: table.nextId(),
      user_id: userId,
      occurred_at: toIso(occurredAt) ?? nowIso(),
      event_type: eventType,
      guild_id: guildId,
      summary,
      details,
      visibility,
      source_event_id: sourceEventId,
      created_at: nowIso(),
    };
    table.insert(entry);
    return entry;
  });
}

export async function getTimeline(userId, { limit = 20, before = null, minVisibilityRank = VISIBILITY_RANK.PRIVATE } = {}) {
  const rows = [...getStore().table(T).filter(
    (r) => r.user_id === userId && (VISIBILITY_RANK[r.visibility] ?? 0) >= minVisibilityRank,
  )];
  return paginateDesc(rows, {
    keyOf: (r) => `${r.occurred_at ?? ''}#${String(r.id).padStart(20, '0')}`,
    limit,
    before,
  });
}

export async function countEntries(userId) {
  return getStore().table(T).count((r) => r.user_id === userId);
}
