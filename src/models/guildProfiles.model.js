import { withTransaction, getStore } from '../db/index.js';
import { TABLE_NAMES, blankRow } from '../db/json/schema.js';
import { nowIso, toIso, maxIso, minIso } from '../utils/dates.js';
import { paginateDesc } from '../utils/paginate.js';

const T = TABLE_NAMES.GUILD_USER_PROFILES;
const pkOf = (row) => `${row.guild_id}:${row.user_id}`;
const keyOf = (row) => `${row.last_seen_at ?? ''}#${row.user_id.padStart(20, '0')}`;
const ACTIVE_STATUSES = ['MEMBER', 'GUEST', 'PENDING'];

/**
 * Insert-or-merge the guild↔user relationship. Membership transitions keep
 * the earliest joined_at and the earliest observed left_at so event replays
 * and out-of-order deliveries cannot corrupt the timeline.
 */
export async function upsertGuildUser({
  guildId, userId, seenAt, joinedAt = null, leftAt = null,
  membershipStatus = null, nickname = null, avatarHash = null, verificationStatus = null,
}) {
  return withTransaction((tx) => {
    const table = tx.table(T);
    const at = toIso(seenAt) ?? nowIso();
    const pk = `${guildId}:${userId}`;
    const existing = table.get(pk);

    if (!existing) {
      const status = membershipStatus ?? 'MEMBER';
      const row = {
        ...blankRow(T, pk),
        membership_status: status,
        nickname: nickname != null ? String(nickname).slice(0, 32) : null,
        avatar_hash: avatarHash != null ? String(avatarHash).slice(0, 128) : null,
        verification_status: verificationStatus ?? 'UNVERIFIED',
        joined_at: status === 'MEMBER' ? (toIso(joinedAt) ?? at) : toIso(joinedAt),
        left_at: status === 'LEFT' || status === 'BANNED' ? (toIso(leftAt) ?? at) : toIso(leftAt),
        first_seen_at: at,
        last_seen_at: at,
      };
      table.insert(row);
      return { created: true, profile: row };
    }

    const patch = { last_seen_at: maxIso(existing.last_seen_at, at), updated_at: nowIso() };
    if (nickname != null) patch.nickname = String(nickname).slice(0, 32);
    if (avatarHash != null) patch.avatar_hash = String(avatarHash).slice(0, 128);
    if (verificationStatus != null) patch.verification_status = verificationStatus;

    if (membershipStatus != null && membershipStatus !== existing.membership_status) {
      // Never regress BANNED via race-prone leave events — only an explicit
      // UNBAN moderation action lifts a ban (Discord fires ban + leave both).
      const bannedRegression = existing.membership_status === 'BANNED' && membershipStatus === 'LEFT';
      if (!bannedRegression) {
        patch.membership_status = membershipStatus;
        if (membershipStatus === 'MEMBER') {
          patch.joined_at = existing.joined_at
            ? minIso(existing.joined_at, toIso(joinedAt) ?? at)
            : (toIso(joinedAt) ?? at);
          patch.left_at = null;
        } else if (membershipStatus === 'LEFT' || membershipStatus === 'BANNED') {
          patch.left_at = existing.left_at
            ? minIso(existing.left_at, toIso(leftAt) ?? at)
            : (toIso(leftAt) ?? at);
        }
      }
    }

    return { created: false, profile: table.update(pk, patch) };
  });
}

export async function setMembershipStatus({ guildId, userId, status, at }) {
  return upsertGuildUser({ guildId, userId, seenAt: at, membershipStatus: status, leftAt: at });
}

export async function setDataSharingEnabled(guildId, userId, enabled, { updatedByUserId = null } = {}) {
  return withTransaction((tx) => {
    const table = tx.table(T);
    const pk = `${guildId}:${userId}`;
    if (!table.has(pk)) {
      const row = { ...blankRow(T, pk), data_sharing_enabled: Boolean(enabled) };
      table.insert(row);
      return row;
    }
    return table.update(pk, { data_sharing_enabled: Boolean(enabled), updated_at: nowIso() });
  });
}

export async function setSourceStatus(guildId, userId, status) {
  return withTransaction((tx) => {
    const table = tx.table(T);
    const pk = `${guildId}:${userId}`;
    if (!table.has(pk)) {
      const row = { ...blankRow(T, pk), source_status: status };
      table.insert(row);
      return row;
    }
    return table.update(pk, { source_status: status, updated_at: nowIso() });
  });
}

export async function getGuildUser(guildId, userId) {
  return getStore().table(T).get(`${guildId}:${userId}`) ?? null;
}

export async function listGuildUsers(guildId, { limit = 50, status = null } = {}) {
  const rows = [...getStore().table(T).filter(
    (r) => r.guild_id === guildId && (status == null || r.membership_status === status),
  )];
  return paginateDesc(rows, { keyOf, limit });
}

export async function listUserGuilds(userId, { activeOnly = false } = {}) {
  return [...getStore().table(T).filter(
    (r) => r.user_id === userId && (!activeOnly || ACTIVE_STATUSES.includes(r.membership_status)),
  )];
}

export async function countGuildMembers(guildId) {
  return getStore().table(T).count(
    (r) => r.guild_id === guildId && r.membership_status === 'MEMBER',
  );
}

export async function countUserGuilds(userId, { activeOnly = false } = {}) {
  const rows = await listUserGuilds(userId, { activeOnly });
  return rows.length;
}
