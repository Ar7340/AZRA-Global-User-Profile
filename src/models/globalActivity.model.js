import { withTransaction, getStore } from '../db/index.js';
import { TABLE_NAMES, blankRow } from '../db/json/schema.js';
import { nowIso, toIso, maxIso, minIso, dateOnly } from '../utils/dates.js';
import { ValidationError } from '../utils/errors.js';
import { ACTIVITY_COUNTER_FIELD } from '../domain/catalog.js';
import { paginateDesc } from '../utils/paginate.js';

const T = TABLE_NAMES.GLOBAL_ACTIVITY;
const D = TABLE_NAMES.GLOBAL_ACTIVITY_DAILY;

function resolveCounterField(kind) {
  const field = ACTIVITY_COUNTER_FIELD[kind];
  if (!field) throw new ValidationError(`Unknown activity kind "${kind}"`);
  return field;
}

/** Increments a global activity counter. Counters only move for events that
 *  passed the permission gate, so totals never include unauthorized sources. */
export async function incrementActivity({ userId, kind, amount = 1, at }) {
  const field = resolveCounterField(kind);
  const iso = toIso(at) ?? nowIso();
  const delta = Math.max(0, Number(amount) || 0);

  return withTransaction((tx) => {
    const table = tx.table(T);
    const existing = table.get(userId);
    if (!existing) {
      const row = blankRow(T, userId);
      row[field] = delta;
      row.first_active_at = iso;
      row.last_active_at = iso;
      table.insert(row);
      return { created: true, row };
    }
    const row = table.update(userId, {
      [field]: (existing[field] ?? 0) + delta,
      first_active_at: minIso(existing.first_active_at, iso),
      last_active_at: maxIso(existing.last_active_at, iso),
      updated_at: nowIso(),
    });
    return { created: false, row };
  });
}

/** Per-day bucket — enables time-series views without scanning full history. */
export async function recordDailyActivity({ userId, kind, amount = 1, at }) {
  const field = resolveCounterField(kind);
  const iso = toIso(at) ?? nowIso();
  const day = dateOnly(iso);
  const delta = Math.max(0, Number(amount) || 0);

  return withTransaction((tx) => {
    const table = tx.table(D);
    const pk = `${userId}:${day}`;
    const existing = table.get(pk);
    if (!existing) {
      const row = blankRow(D, pk);
      row[field] = delta;
      table.insert(row);
      return row;
    }
    return table.update(pk, { [field]: (existing[field] ?? 0) + delta, updated_at: nowIso() });
  });
}

/** null = AZRA holds no activity data for this user (never fake zeros). */
export async function getTotals(userId) {
  return getStore().table(T).get(userId) ?? null;
}

export async function countDailyBuckets(userId) {
  return getStore().table(D).count((r) => r.user_id === userId);
}

export async function getRecentDaily(userId, { limit = 7 } = {}) {
  const rows = [...getStore().table(D).filter((r) => r.user_id === userId)];
  return rows.sort((a, b) => (b.activity_date ?? '').localeCompare(a.activity_date ?? '')).slice(0, limit);
}

/** Written by the aggregation service when recomputing cross-guild totals. */
export async function setAggregates(userId, aggregates = {}) {
  return withTransaction((tx) => {
    const table = tx.table(T);
    const existing = table.get(userId);
    const patch = {
      contributing_guilds: aggregates.contributingGuilds ?? existing?.contributing_guilds ?? 0,
      messages_seen: aggregates.messagesSeen ?? existing?.messages_seen ?? 0,
      reactions_added: aggregates.reactionsAdded ?? existing?.reactions_added ?? 0,
      voice_minutes: aggregates.voiceMinutes ?? existing?.voice_minutes ?? 0,
      commands_used: aggregates.commandsUsed ?? existing?.commands_used ?? 0,
      active_days: aggregates.activeDays ?? existing?.active_days ?? 0,
      first_active_at: aggregates.firstActiveAt ?? existing?.first_active_at ?? null,
      last_active_at: aggregates.lastActiveAt ?? existing?.last_active_at ?? null,
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

export async function getRecentDailyPage(userId, { limit = 30, before = null } = {}) {
  const rows = [...getStore().table(D).filter((r) => r.user_id === userId)];
  return paginateDesc(rows, { keyOf: (r) => r.activity_date ?? '', limit, before });
}
