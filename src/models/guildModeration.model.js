import { withTransaction, getStore } from '../db/index.js';
import { TABLE_NAMES } from '../db/json/schema.js';
import { nowIso, toIso } from '../utils/dates.js';
import { NotFoundError } from '../utils/errors.js';
import { paginateDesc } from '../utils/paginate.js';

const T = TABLE_NAMES.GUILD_USER_MODERATION;
const TEMP_ENFORCED = ['TIMEOUT', 'MUTE'];
const keyOf = (row) => `${row.issued_at ?? ''}#${String(row.id).padStart(20, '0')}`;

/**
 * Records a guild-local moderation action. Idempotent per sourceEventId so
 * duplicate Discord audit events never double-count. Reasons never leave the
 * guild layer unless the guild's MODERATION permission allows it.
 */
export async function addModerationAction({
  guildId, userId, caseId = null, actionType, reason = null, moderatorId = null,
  issuedAt, expiresAt = null, sourceEventId = null,
}) {
  return withTransaction((tx) => {
    const table = tx.table(T);
    if (sourceEventId) {
      const existing = table.find((r) => r.source_event_id === sourceEventId);
      if (existing) return { created: false, action: existing };
    }
    const issuedAtIso = toIso(issuedAt) ?? nowIso();
    const expiresAtIso = toIso(expiresAt);
    const action = {
      id: table.nextId(),
      guild_id: guildId,
      user_id: userId,
      case_id: caseId != null ? String(caseId).slice(0, 64) : null,
      action_type: actionType,
      reason: reason != null ? String(reason).slice(0, 500) : null,
      moderator_id: moderatorId,
      issued_at: issuedAtIso,
      expires_at: expiresAtIso,
      active: TEMP_ENFORCED.includes(actionType) && expiresAtIso != null,
      lifted_at: null,
      source_event_id: sourceEventId,
      created_at: nowIso(),
    };
    table.insert(action);
    return { created: true, action };
  });
}

export async function getAction(id) {
  return getStore().table(T).get(String(id)) ?? null;
}

export async function getBySourceEvent(sourceEventId) {
  return getStore().table(T).find((r) => r.source_event_id === sourceEventId) ?? null;
}

export async function listGuildUserActions(guildId, userId, { limit = 25, before = null } = {}) {
  const rows = [...getStore().table(T).filter(
    (r) => r.guild_id === guildId && r.user_id === userId,
  )];
  return paginateDesc(rows, { keyOf, limit, before });
}

export async function listUserActionsAcrossGuilds(userId, { limit = 25, before = null } = {}) {
  const rows = [...getStore().table(T).filter((r) => r.user_id === userId)];
  return paginateDesc(rows, { keyOf, limit, before });
}

/** Per-action-type counts for one guild↔user pair: { WARN: 2, BAN: 1, ... } */
export async function countActionsByType(guildId, userId) {
  const counts = {};
  for (const row of getStore().table(T).filter(
    (r) => r.guild_id === guildId && r.user_id === userId,
  )) {
    counts[row.action_type] = (counts[row.action_type] ?? 0) + 1;
  }
  return counts;
}

export async function liftAction(id, { at } = {}) {
  return withTransaction((tx) => {
    const table = tx.table(T);
    const pk = String(id);
    if (!table.has(pk)) throw new NotFoundError(`Moderation action ${id} not found`);
    return table.update(pk, { active: false, lifted_at: toIso(at) ?? nowIso() });
  });
}

/** Marks enforcement windows (timeouts/mutes) that elapsed as inactive. */
export async function expireDueActions() {
  return withTransaction((tx) => {
    const table = tx.table(T);
    const now = nowIso();
    let expired = 0;
    for (const row of table.filter((r) => r.active && r.expires_at && r.expires_at <= now)) {
      table.update(String(row.id), { active: false, lifted_at: now });
      expired += 1;
    }
    return expired;
  });
}
