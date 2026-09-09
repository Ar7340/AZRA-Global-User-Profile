import { withTransaction, getStore } from '../db/index.js';
import { TABLE_NAMES, blankRow } from '../db/json/schema.js';
import { nowIso } from '../utils/dates.js';

const T = TABLE_NAMES.PROFILE_DATA_PERMISSIONS;
const pk = (guildId, dataCategory) => `${guildId}:${dataCategory}`;

/**
 * The guild→AZRA data-sharing contract, one row per (guild, category).
 * Missing row = NOT allowed (default-deny). This table is the enforcement
 * point for "a server decides what leaves the server".
 */
export async function setPermission({
  guildId, dataCategory, allowed, visibilityCeiling = 'GUILD', updatedByUserId = null,
}) {
  return withTransaction((tx) => {
    const table = tx.table(T);
    const key = pk(guildId, dataCategory);
    const existing = table.get(key);
    if (!existing) {
      const row = {
        ...blankRow(T, key),
        is_allowed: Boolean(allowed),
        visibility_ceiling: visibilityCeiling,
        updated_by_user_id: updatedByUserId,
      };
      table.insert(row);
      return row;
    }
    return table.update(key, {
      is_allowed: Boolean(allowed),
      visibility_ceiling: visibilityCeiling,
      updated_by_user_id: updatedByUserId,
      updated_at: nowIso(),
    });
  });
}

export async function getPermission(guildId, dataCategory) {
  return getStore().table(T).get(pk(guildId, dataCategory)) ?? null;
}

export async function isCategoryAllowed(guildId, dataCategory) {
  const permission = await getPermission(guildId, dataCategory);
  return Boolean(permission?.is_allowed);
}

export async function listGuildPermissions(guildId) {
  return [...getStore().table(T).filter((r) => r.guild_id === guildId)];
}

/** Guild ids whose permission row allows the given category. */
export async function listAllowedGuildIds(dataCategory) {
  return [...new Set([...getStore().table(T).filter(
    (r) => r.data_category === dataCategory && r.is_allowed,
  )].map((r) => r.guild_id))];
}

/** Replaces a guild's permission set from a { CATEGORY: {allowed, visibilityCeiling} } map. */
export async function replaceGuildPermissions(guildId, permissionsByCategory, { updatedByUserId = null } = {}) {
  return withTransaction(async (tx) => {
    const results = [];
    for (const [dataCategory, config] of Object.entries(permissionsByCategory)) {
      const table = tx.table(T);
      const key = pk(guildId, dataCategory);
      const patch = {
        is_allowed: Boolean(config.allowed),
        visibility_ceiling: config.visibilityCeiling ?? 'GUILD',
        updated_by_user_id: updatedByUserId,
        updated_at: nowIso(),
      };
      if (!table.has(key)) {
        const row = { ...blankRow(T, key), ...patch };
        table.insert(row);
        results.push(row);
      } else {
        results.push(table.update(key, patch));
      }
    }
    return results;
  });
}
