import { withTransaction, getStore } from '../db/index.js';
import { TABLE_NAMES, blankRow } from '../db/json/schema.js';
import { nowIso, toIso } from '../utils/dates.js';
import { ValidationError } from '../utils/errors.js';

const T = TABLE_NAMES.GLOBAL_REPUTATION;

export async function getReputation(userId) {
  return getStore().table(T).get(userId) ?? null;
}

/** Applies a raw reputation signal (counter only; score is recomputed by the
 *  aggregation service so ad-hoc tweaks never corrupt the formula). */
export async function applySignal(userId, { direction, amount = 1 } = {}) {
  if (direction !== 'POSITIVE' && direction !== 'NEGATIVE') {
    throw new ValidationError(`Invalid reputation signal direction "${direction}"`);
  }
  const delta = Math.max(1, Math.min(10, Number(amount) || 1));

  return withTransaction((tx) => {
    const table = tx.table(T);
    const existing = table.get(userId);
    if (!existing) {
      const row = blankRow(T, userId);
      if (direction === 'POSITIVE') row.positive_signals = delta;
      else row.negative_signals = delta;
      table.insert(row);
      return row;
    }
    const field = direction === 'POSITIVE' ? 'positive_signals' : 'negative_signals';
    return table.update(userId, { [field]: (existing[field] ?? 0) + delta, updated_at: nowIso() });
  });
}

/** Writes the recomputed score; preserves raw signal counters. */
export async function setReputation(userId, { score, level, breakdown = null }) {
  return withTransaction((tx) => {
    const table = tx.table(T);
    const existing = table.get(userId);
    const patch = {
      reputation_score: Math.round(score),
      level,
      breakdown: breakdown ?? null,
      calculated_at: nowIso(),
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
