import { withTransaction, getStore } from '../db/index.js';
import { TABLE_NAMES, blankRow } from '../db/json/schema.js';
import { nowIso, toIso } from '../utils/dates.js';

const T = TABLE_NAMES.GUILD_USER_VERIFICATION;
const pk = (guildId, userId) => `${guildId}:${userId}`;

/** Upserts the latest guild-local verification state (one row per pair). */
export async function setVerification({
  guildId, userId, method = 'MANUAL', status = 'VERIFIED', verifiedAt = null,
  verifiedByUserId = null, expiresAt = null, sourceEventId = null,
}) {
  return withTransaction((tx) => {
    const table = tx.table(T);
    const key = pk(guildId, userId);
    const existing = table.get(key);
    if (!existing) {
      const row = {
        ...blankRow(T, key),
        method,
        status,
        verified_at: toIso(verifiedAt),
        verified_by_user_id: verifiedByUserId,
        expires_at: toIso(expiresAt),
        source_event_id: sourceEventId,
      };
      table.insert(row);
      return { created: true, verification: row };
    }
    const verification = table.update(key, {
      method,
      status,
      verified_at: toIso(verifiedAt) ?? existing.verified_at,
      verified_by_user_id: verifiedByUserId ?? existing.verified_by_user_id,
      expires_at: toIso(expiresAt),
      source_event_id: sourceEventId ?? existing.source_event_id,
      updated_at: nowIso(),
    });
    return { created: false, verification };
  });
}

export async function getVerification(guildId, userId) {
  return getStore().table(T).get(pk(guildId, userId)) ?? null;
}

export async function listUserVerifications(userId) {
  return [...getStore().table(T).filter((r) => r.user_id === userId)];
}

export async function countVerifiedGuilds(userId) {
  return getStore().table(T).count((r) => r.user_id === userId && r.status === 'VERIFIED');
}
