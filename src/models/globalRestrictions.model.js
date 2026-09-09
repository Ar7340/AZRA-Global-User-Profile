import { withTransaction, getStore } from '../db/index.js';
import { TABLE_NAMES } from '../db/json/schema.js';
import { nowIso, toIso } from '../utils/dates.js';

const T = TABLE_NAMES.GLOBAL_RESTRICTIONS;

function expireDueInTx(table, now) {
  for (const row of table.filter((r) => r.status === 'ACTIVE' && r.expires_at && r.expires_at <= now)) {
    table.update(String(row.id), { status: 'EXPIRED', updated_at: now });
  }
}

/** Applies a platform-level restriction. One active restriction per type. */
export async function applyRestriction({
  userId, restrictionType, reason = null, sourceGuildId = null,
  issuedByUserId = null, startsAt, expiresAt = null, sourceEventId = null,
}) {
  return withTransaction((tx) => {
    const table = tx.table(T);
    const now = nowIso();
    expireDueInTx(table, now);
    const startsAtIso = toIso(startsAt) ?? now;

    const existing = table.find(
      (r) => r.user_id === userId && r.restriction_type === restrictionType && r.status === 'ACTIVE',
    );
    if (existing) return { created: false, restriction: existing };

    const restriction = {
      id: table.nextId(),
      user_id: userId,
      restriction_type: restrictionType,
      reason,
      source_guild_id: sourceGuildId,
      issued_by_user_id: issuedByUserId,
      starts_at: startsAtIso,
      expires_at: toIso(expiresAt),
      status: 'ACTIVE',
      lifted_at: null,
      lifted_by_user_id: null,
      source_event_id: sourceEventId,
      created_at: now,
      updated_at: now,
    };
    table.insert(restriction);
    return { created: true, restriction };
  });
}

export async function liftRestriction(userId, restrictionType, { liftedByUserId = null, at } = {}) {
  return withTransaction((tx) => {
    const table = tx.table(T);
    const now = nowIso();
    expireDueInTx(table, now);
    const active = table.find(
      (r) => r.user_id === userId && r.restriction_type === restrictionType && r.status === 'ACTIVE',
    );
    if (!active) return { lifted: false, restriction: null };
    const restriction = table.update(String(active.id), {
      status: 'LIFTED',
      lifted_at: toIso(at) ?? now,
      lifted_by_user_id: liftedByUserId,
      updated_at: now,
    });
    return { lifted: true, restriction };
  });
}

export async function getActiveRestrictions(userId) {
  return withTransaction((tx) => {
    const table = tx.table(T);
    expireDueInTx(table, nowIso());
    return [...table.filter((r) => r.user_id === userId && r.status === 'ACTIVE')];
  });
}

export async function hasActiveRestriction(userId, restrictionType) {
  const rows = await getActiveRestrictions(userId);
  return rows.some((r) => r.restriction_type === restrictionType);
}

export async function countActiveRestrictions(userId) {
  const rows = await getActiveRestrictions(userId);
  return rows.length;
}
