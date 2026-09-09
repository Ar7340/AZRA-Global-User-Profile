import { withTransaction, getStore } from '../db/index.js';
import { TABLE_NAMES, blankRow } from '../db/json/schema.js';
import { nowIso, toIso, maxIso } from '../utils/dates.js';
import { NotFoundError } from '../utils/errors.js';
import { cache, CACHE_KEYS } from '../cache/cache.js';

const T = TABLE_NAMES.GUILDS;
const pkOf = (row) => row.guild_id;

/** Registers or refreshes a guild. `is_participating` defaults to true for
 *  every level except NONE — participation is the guild's explicit opt-in. */
export async function upsertGuild({
  guildId, name = null, iconHash = null, memberCount = null,
  dataSharingLevel = 'NONE', isParticipating, seenAt,
}) {
  return withTransaction((tx) => {
    const table = tx.table(T);
    const at = toIso(seenAt) ?? nowIso();
    const existing = table.get(guildId);

    if (!existing) {
      const row = {
        ...blankRow(T, guildId),
        name: name ?? `Guild ${guildId}`,
        icon_hash: iconHash,
        member_count: memberCount ?? null,
        data_sharing_level: dataSharingLevel,
        is_participating: isParticipating ?? dataSharingLevel !== 'NONE',
        first_seen_at: at,
        last_event_at: at,
      };
      table.insert(row);
      cache.delete(CACHE_KEYS.participating);
      return { created: true, guild: row };
    }

    const patch = {
      last_event_at: maxIso(existing.last_event_at, at),
      updated_at: nowIso(),
    };
    if (name != null) patch.name = String(name).slice(0, 100);
    if (iconHash != null) patch.icon_hash = String(iconHash).slice(0, 128);
    if (memberCount != null) patch.member_count = Math.max(0, Math.trunc(Number(memberCount) || 0));
    if (dataSharingLevel != null) patch.data_sharing_level = dataSharingLevel;
    if (isParticipating != null) patch.is_participating = Boolean(isParticipating);
    const guild = table.update(pkOf(existing), patch);
    cache.delete(CACHE_KEYS.participating);
    return { created: false, guild };
  });
}

const PATCH_FIELDS = {
  name: (v) => String(v).slice(0, 100),
  iconHash: (v) => String(v).slice(0, 128),
  memberCount: (v) => Math.max(0, Math.trunc(Number(v) || 0)),
  dataSharingLevel: (v) => v,
  isParticipating: (v) => Boolean(v),
  status: (v) => v,
};

export async function updateGuild(guildId, patch = {}) {
  return withTransaction((tx) => {
    const table = tx.table(T);
    const mapped = {};
    for (const [key, value] of Object.entries(patch)) {
      if (value != null && PATCH_FIELDS[key]) mapped[key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)] = PATCH_FIELDS[key](value);
    }
    mapped.updated_at = nowIso();
    const guild = table.update(guildId, mapped);
    cache.delete(CACHE_KEYS.participating);
    return guild;
  });
}

export async function getGuild(guildId) {
  return getStore().table(T).get(guildId) ?? null;
}

export async function requireGuild(guildId) {
  const guild = await getGuild(guildId);
  if (!guild) throw new NotFoundError(`Guild ${guildId} is not registered with AZRA`);
  return guild;
}

function loadParticipationStats() {
  const table = getStore().table(T);
  const active = [...table.filter((g) => g.status === 'ACTIVE')];
  return {
    total: active.length,
    participating: active.filter((g) => g.is_participating).length,
  };
}

/** Cached — participating counts are read on every summary/coverage call. */
export async function getParticipationStats() {
  return cache.wrap(CACHE_KEYS.participating, loadParticipationStats, { ttlMs: 5_000 });
}

export async function listParticipatingGuildIds() {
  return [...getStore().table(T).filter((g) => g.is_participating && g.status === 'ACTIVE')]
    .map((g) => g.guild_id);
}

export async function countParticipatingGuilds() {
  return getStore().table(T).count((g) => g.is_participating && g.status === 'ACTIVE');
}

export async function listGuilds({ participatingOnly = false, limit = 50 } = {}) {
  let rows = getStore().table(T).toArray();
  if (participatingOnly) rows = rows.filter((g) => g.is_participating && g.status === 'ACTIVE');
  return rows
    .sort((a, b) => (b.last_event_at ?? '').localeCompare(a.last_event_at ?? ''))
    .slice(0, limit);
}
