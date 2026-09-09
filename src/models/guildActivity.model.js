import { withTransaction, getStore } from '../db/index.js';
import { TABLE_NAMES, blankRow } from '../db/json/schema.js';
import { nowIso, toIso, maxIso, minIso } from '../utils/dates.js';
import { ValidationError } from '../utils/errors.js';
import { ACTIVITY_COUNTER_FIELD } from '../domain/catalog.js';

const T = TABLE_NAMES.GUILD_USER_ACTIVITY;

function resolveCounterField(kind) {
  const field = ACTIVITY_COUNTER_FIELD[kind];
  if (!field) throw new ValidationError(`Unknown activity kind "${kind}"`);
  return field;
}

export function hasAnyActivity(row) {
  if (!row) return false;
  return (
    (row.messages_seen ?? 0) > 0
    || (row.reactions_added ?? 0) > 0
    || (row.voice_minutes ?? 0) > 0
    || (row.commands_used ?? 0) > 0
  );
}

export async function incrementActivity({ guildId, userId, kind, amount = 1, at }) {
  const field = resolveCounterField(kind);
  const iso = toIso(at) ?? nowIso();
  const delta = Math.max(0, Number(amount) || 0);

  return withTransaction((tx) => {
    const table = tx.table(T);
    const pk = `${guildId}:${userId}`;
    const existing = table.get(pk);
    if (!existing) {
      const row = blankRow(T, pk);
      row[field] = delta;
      row.first_active_at = iso;
      row.last_active_at = iso;
      table.insert(row);
      return { created: true, row };
    }
    const row = table.update(pk, {
      [field]: (existing[field] ?? 0) + delta,
      first_active_at: minIso(existing.first_active_at, iso),
      last_active_at: maxIso(existing.last_active_at, iso),
      updated_at: nowIso(),
    });
    return { created: false, row };
  });
}

export async function getTotals(guildId, userId) {
  return getStore().table(T).get(`${guildId}:${userId}`) ?? null;
}

export async function listUserGuildActivity(userId) {
  return [...getStore().table(T).filter((r) => r.user_id === userId)];
}

/** How many distinct guilds contributed activity data for this user
 *  (unfiltered; the aggregation service applies participation filters). */
export async function countDistinctActiveGuilds(userId) {
  return [...getStore().table(T).filter((r) => r.user_id === userId)]
    .filter((r) => hasAnyActivity(r)).length;
}
