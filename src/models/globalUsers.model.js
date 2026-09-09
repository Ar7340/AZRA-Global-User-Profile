import { withTransaction, getStore } from '../db/index.js';
import { TABLE_NAMES } from '../db/json/schema.js';
import { nowIso, toIso, maxIso } from '../utils/dates.js';
import { NotFoundError } from '../utils/errors.js';
import { paginateDesc } from '../utils/paginate.js';

const T = TABLE_NAMES.GLOBAL_USERS;
const pkOf = (row) => row.user_id;
const keyOf = (row) => `${row.last_seen_at ?? ''}#${row.user_id.padStart(20, '0')}`;

/** Insert-or-merge a global user. `seenAt` never regresses; provided fields
 *  only overwrite when present. Idempotent under event replays. */
export async function upsertUser(input = {}) {
  return withTransaction((tx) => {
    const table = tx.table(T);
    const at = toIso(input.seenAt) ?? nowIso();
    const existing = table.get(input.userId);

    if (!existing) {
      const row = {
        user_id: input.userId,
        username: input.username != null ? String(input.username).slice(0, 32) : null,
        global_name: input.globalName != null ? String(input.globalName).slice(0, 32) : null,
        avatar_hash: input.avatarHash != null ? String(input.avatarHash).slice(0, 128) : null,
        is_bot: Boolean(input.isBot),
        account_created_at: toIso(input.accountCreatedAt) ?? null,
        first_seen_at: at,
        last_seen_at: at,
        created_at: nowIso(),
        updated_at: nowIso(),
      };
      table.insert(row);
      return { created: true, user: row };
    }

    const patch = { last_seen_at: maxIso(existing.last_seen_at, at), updated_at: nowIso() };
    if (input.username != null) patch.username = String(input.username).slice(0, 32);
    if (input.globalName != null) patch.global_name = String(input.globalName).slice(0, 32);
    if (input.avatarHash != null) patch.avatar_hash = String(input.avatarHash).slice(0, 128);
    if (input.isBot != null) patch.is_bot = Boolean(input.isBot);
    if (input.accountCreatedAt != null && !existing.account_created_at) {
      patch.account_created_at = toIso(input.accountCreatedAt);
    }
    return { created: false, user: table.update(pkOf(existing), patch) };
  });
}

export async function getUser(userId) {
  return getStore().table(T).get(userId) ?? null;
}

export async function requireUser(userId) {
  const user = await getUser(userId);
  if (!user) {
    throw new NotFoundError(`Global user ${userId} not found`);
  }
  return user;
}

export async function countUsers() {
  return getStore().table(T).size;
}

export async function listUsers({ limit = 25, before = null } = {}) {
  return paginateDesc(getStore().table(T).toArray(), { keyOf, limit, before });
}
