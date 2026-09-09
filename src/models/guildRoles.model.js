import { withTransaction, getStore } from '../db/index.js';
import { TABLE_NAMES } from '../db/json/schema.js';
import { nowIso, toIso } from '../utils/dates.js';
import { paginateDesc } from '../utils/paginate.js';

const T = TABLE_NAMES.GUILD_USER_ROLES;

const findActive = (table, guildId, userId, roleId) =>
  table.find(
    (r) => r.guild_id === guildId && r.user_id === userId
      && r.role_id === String(roleId) && r.removed_at == null,
  );

/**
 * Adds (or re-activates) a role grant. Re-adding a previously removed role
 * reuses the historical row so the role history stays a single continuous
 * record per (guild, user, role).
 */
export async function addRole({
  guildId, userId, roleId, roleName = null, rolePosition = null,
  addedAt, grantedByUserId = null, sourceEventId = null,
}) {
  return withTransaction((tx) => {
    const table = tx.table(T);
    const at = toIso(addedAt) ?? nowIso();
    const patch = {
      role_name: roleName != null ? String(roleName).slice(0, 100) : null,
      role_position: rolePosition != null ? Math.trunc(Number(rolePosition)) : null,
      added_at: at,
      removed_at: null,
      granted_by_user_id: grantedByUserId,
      source_event_id: sourceEventId,
    };

    const active = findActive(table, guildId, userId, roleId);
    if (active) {
      const role = table.update(String(active.id), {
        role_name: patch.role_name ?? active.role_name,
        role_position: patch.role_position ?? active.role_position,
        granted_by_user_id: grantedByUserId ?? active.granted_by_user_id,
        source_event_id: sourceEventId ?? active.source_event_id,
      });
      return { created: false, reactivated: false, role };
    }

    const previouslyRemoved = table.find(
      (r) => r.guild_id === guildId && r.user_id === userId
        && r.role_id === String(roleId) && r.removed_at != null,
    );
    if (previouslyRemoved) {
      const role = table.update(String(previouslyRemoved.id), patch);
      return { created: false, reactivated: true, role };
    }

    const role = {
      id: table.nextId(),
      guild_id: guildId,
      user_id: userId,
      role_id: String(roleId),
      role_name: patch.role_name,
      role_position: patch.role_position,
      added_at: at,
      removed_at: null,
      granted_by_user_id: grantedByUserId,
      source_event_id: sourceEventId,
      created_at: nowIso(),
    };
    table.insert(role);
    return { created: true, reactivated: false, role };
  });
}

export async function removeRole({ guildId, userId, roleId, removedAt }) {
  return withTransaction((tx) => {
    const table = tx.table(T);
    const active = findActive(table, guildId, userId, roleId);
    if (!active) return { removed: false, role: null };
    const role = table.update(String(active.id), {
      removed_at: toIso(removedAt) ?? nowIso(),
    });
    return { removed: true, role };
  });
}

export async function listActiveRoles(guildId, userId) {
  const rows = [...getStore().table(T).filter(
    (r) => r.guild_id === guildId && r.user_id === userId && r.removed_at == null,
  )];
  return rows.sort((a, b) => (b.role_position ?? -1) - (a.role_position ?? -1));
}

export async function listRoleHistory(guildId, userId, { limit = 50, before = null } = {}) {
  const rows = [...getStore().table(T).filter(
    (r) => r.guild_id === guildId && r.user_id === userId,
  )];
  return paginateDesc(rows, {
    keyOf: (r) => `${r.added_at ?? ''}#${String(r.id).padStart(20, '0')}`,
    limit,
    before,
  });
}

export async function countActiveRoles(guildId, userId) {
  return getStore().table(T).count(
    (r) => r.guild_id === guildId && r.user_id === userId && r.removed_at == null,
  );
}
