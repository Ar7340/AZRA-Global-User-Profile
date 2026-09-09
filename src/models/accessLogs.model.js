import { withTransaction, getStore } from '../db/index.js';
import { TABLE_NAMES } from '../db/json/schema.js';
import { nowIso, toIso } from '../utils/dates.js';
import { paginateDesc } from '../utils/paginate.js';

const T = TABLE_NAMES.PROFILE_ACCESS_LOGS;
const keyOf = (row) => `${row.accessed_at ?? ''}#${String(row.id).padStart(20, '0')}`;

/**
 * Audit trail of who looked at whose profile and what they were allowed to
 * see. Written best-effort by the profile service; failures never block a
 * read but are logged.
 */
export async function logAccess({
  viewerId = null, targetUserId, guildId = null, accessScope,
  fieldsAccessed = null, outcome = 'ALLOWED', denyReason = null, accessedAt,
}) {
  return withTransaction((tx) => {
    const table = tx.table(T);
    const entry = {
      id: table.nextId(),
      viewer_id: viewerId,
      target_user_id: targetUserId,
      guild_id: guildId,
      access_scope: accessScope,
      fields_accessed: fieldsAccessed ?? null,
      outcome,
      deny_reason: denyReason,
      accessed_at: toIso(accessedAt) ?? nowIso(),
      created_at: nowIso(),
    };
    table.insert(entry);
    return entry;
  });
}

export async function listByTarget(userId, { limit = 50, before = null } = {}) {
  const rows = [...getStore().table(T).filter((r) => r.target_user_id === userId)];
  return paginateDesc(rows, { keyOf, limit, before });
}

export async function listByViewer(viewerId, { limit = 50, before = null } = {}) {
  const rows = [...getStore().table(T).filter((r) => r.viewer_id === viewerId)];
  return paginateDesc(rows, { keyOf, limit, before });
}

export async function countByOutcome(outcome) {
  return getStore().table(T).count((r) => r.outcome === outcome);
}

/** Retention hook — call from a scheduled job to prune old access logs. */
export async function purgeOlderThan(cutoffIso) {
  return withTransaction((tx) => {
    const table = tx.table(T);
    const cutoff = toIso(cutoffIso);
    let purged = 0;
    for (const row of table.filter((r) => r.accessed_at < cutoff)) {
      table.delete(String(row.id));
      purged += 1;
    }
    return purged;
  });
}
