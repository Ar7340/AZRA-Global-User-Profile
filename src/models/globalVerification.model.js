import { withTransaction, getStore } from '../db/index.js';
import { TABLE_NAMES, blankRow } from '../db/json/schema.js';
import { nowIso, toIso } from '../utils/dates.js';

const T = TABLE_NAMES.GLOBAL_VERIFICATION;

export async function getVerification(userId) {
  return getStore().table(T).get(userId) ?? null;
}

/**
 * Writes the aggregated global verification state for a user. Called by the
 * aggregation service after recounting confirming guilds — never written
 * directly from raw events (single-server data must never become global
 * truth on its own).
 */
export async function setVerificationState(userId, state = {}) {
  return withTransaction((tx) => {
    const table = tx.table(T);
    const existing = table.get(userId);
    const patch = {
      status: state.status ?? existing?.status ?? 'UNKNOWN',
      highest_level: state.highestLevel ?? existing?.highest_level ?? 'NONE',
      verified_at: state.verifiedAt ?? existing?.verified_at ?? null,
      last_verified_at: state.lastVerifiedAt ?? existing?.last_verified_at ?? null,
      confirming_guilds: state.confirmingGuilds ?? existing?.confirming_guilds ?? 0,
      updated_at: nowIso(),
    };
    if (!existing) {
      const row = { ...blankRow(T, userId), ...patch };
      table.insert(row);
      return row;
    }
    return table.update(userId, patch);
  });
}
