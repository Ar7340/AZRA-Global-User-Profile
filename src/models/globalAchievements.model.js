import { withTransaction, getStore } from '../db/index.js';
import { TABLE_NAMES } from '../db/json/schema.js';
import { nowIso, toIso } from '../utils/dates.js';
import { paginateDesc } from '../utils/paginate.js';

const T = TABLE_NAMES.GLOBAL_ACHIEVEMENTS;
const keyOf = (row) => `${row.achieved_at ?? ''}#${row.achievement_key}`;

/** Unlocks an achievement. Idempotent per (user, achievement). */
export async function unlockAchievement({
  userId, achievementKey, tier = 1, achievedAt,
  sourceGuildId = null, sourceEventId = null,
}) {
  return withTransaction((tx) => {
    const table = tx.table(T);
    const existing = table.find(
      (r) => r.user_id === userId && r.achievement_key === achievementKey,
    );
    if (existing) return { created: false, achievement: existing };

    const achievement = {
      user_id: userId,
      achievement_key: achievementKey,
      tier,
      achieved_at: toIso(achievedAt) ?? nowIso(),
      source_guild_id: sourceGuildId,
      source_event_id: sourceEventId,
      created_at: nowIso(),
    };
    table.insert(achievement);
    return { created: true, achievement };
  });
}

export async function listAchievements(userId, { limit = 20, before = null } = {}) {
  const rows = [...getStore().table(T).filter((r) => r.user_id === userId)];
  return paginateDesc(rows, { keyOf, limit, before });
}

export async function countAchievements(userId) {
  return getStore().table(T).count((r) => r.user_id === userId);
}
