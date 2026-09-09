import { withTransaction, getStore } from '../db/index.js';
import { TABLE_NAMES } from '../db/json/schema.js';
import { nowIso, toIso } from '../utils/dates.js';
import { NotFoundError } from '../utils/errors.js';

const T = TABLE_NAMES.GLOBAL_BADGES;
const findByNaturalKey = (table, userId, badgeKey) =>
  table.find((r) => r.user_id === userId && r.badge_key === badgeKey);

/**
 * Awards a global badge. Natural key (user, badge) keeps one row per badge:
 * - not present          → created
 * - present and active   → idempotent no-op
 * - present but revoked  → un-revoked (reactivated)
 */
export async function awardBadge({
  userId, badgeKey, awardedByGuildId = null, awardedByUserId = null,
  awardedAt, sourceEventId = null,
}) {
  return withTransaction((tx) => {
    const table = tx.table(T);
    const at = toIso(awardedAt) ?? nowIso();
    const existing = findByNaturalKey(table, userId, badgeKey);

    if (existing) {
      if (!existing.revoked_at) {
        return { created: false, reactivated: false, badge: existing };
      }
      const badge = table.update(table.pkOf(existing), {
        revoked_at: null,
        revoked_reason: null,
        awarded_at: at,
        awarded_by_guild_id: awardedByGuildId,
        awarded_by_user_id: awardedByUserId,
        source_event_id: sourceEventId,
      });
      return { created: false, reactivated: true, badge };
    }

    const badge = {
      user_id: userId,
      badge_key: badgeKey,
      awarded_by_guild_id: awardedByGuildId,
      awarded_by_user_id: awardedByUserId,
      awarded_at: at,
      revoked_at: null,
      revoked_reason: null,
      source_event_id: sourceEventId,
      created_at: nowIso(),
    };
    table.insert(badge);
    return { created: true, reactivated: false, badge };
  });
}

export async function revokeBadge(userId, badgeKey, { reason = null, revokedAt } = {}) {
  return withTransaction((tx) => {
    const table = tx.table(T);
    const existing = findByNaturalKey(table, userId, badgeKey);
    if (!existing) {
      throw new NotFoundError(`Badge "${badgeKey}" not found for user ${userId}`);
    }
    if (existing.revoked_at) return { revoked: false, badge: existing };
    const badge = table.update(table.pkOf(existing), {
      revoked_at: toIso(revokedAt) ?? nowIso(),
      revoked_reason: reason,
    });
    return { revoked: true, badge };
  });
}

export async function listBadges(userId, { includeRevoked = false } = {}) {
  const rows = [...getStore().table(T).filter((r) => r.user_id === userId)];
  const visible = includeRevoked ? rows : rows.filter((r) => !r.revoked_at);
  return visible.sort((a, b) => (b.awarded_at ?? '').localeCompare(a.awarded_at ?? ''));
}

export async function countActiveBadges(userId) {
  return getStore().table(T).count((r) => r.user_id === userId && !r.revoked_at);
}
