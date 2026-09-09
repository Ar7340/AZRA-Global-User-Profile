import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createTestStore, destroyTestStore } from './helpers.js';
import { getStore, initStore, withTransaction } from '../src/db/index.js';
import { TABLE_NAMES } from '../src/db/json/schema.js';
import { ConflictError, NotFoundError, StorageError } from '../src/utils/errors.js';
import { upsertUser } from '../src/models/globalUsers.model.js';

let dir;

beforeEach(async () => {
  dir = await createTestStore('store-test');
});

afterEach(async () => {
  await destroyTestStore();
});

const USER_ROW = {
  user_id: '200000000000000201',
  username: 'alice',
  global_name: null,
  avatar_hash: null,
  is_bot: false,
  account_created_at: null,
  first_seen_at: '2026-08-01T00:00:00.000Z',
  last_seen_at: '2026-08-01T00:00:00.000Z',
  created_at: '2026-08-01T00:00:00.000Z',
  updated_at: '2026-08-01T00:00:00.000Z',
};

test('transaction commit makes rows visible and persistent', async () => {
  await withTransaction((tx) => {
    tx.table(TABLE_NAMES.GLOBAL_USERS).insert({ ...USER_ROW });
  });
  const row = getStore().table(TABLE_NAMES.GLOBAL_USERS).get(USER_ROW.user_id);
  assert.equal(row.username, 'alice');
});

test('transaction rollback restores inserted rows', async () => {
  await assert.rejects(
    () => withTransaction((tx) => {
      tx.table(TABLE_NAMES.GLOBAL_USERS).insert({ ...USER_ROW });
      throw new Error('boom');
    }),
    /boom/,
  );
  assert.equal(getStore().table(TABLE_NAMES.GLOBAL_USERS).size, 0);
});

test('transaction rollback restores updated rows', async () => {
  await withTransaction((tx) => {
    tx.table(TABLE_NAMES.GLOBAL_USERS).insert({ ...USER_ROW });
  });
  await assert.rejects(
    () => withTransaction((tx) => {
      tx.table(TABLE_NAMES.GLOBAL_USERS).update(USER_ROW.user_id, { username: 'changed' });
      throw new Error('rollback-me');
    }),
    /rollback-me/,
  );
  assert.equal(getStore().table(TABLE_NAMES.GLOBAL_USERS).get(USER_ROW.user_id).username, 'alice');
});

test('nested model transactions join the outer transaction', async () => {
  await withTransaction(async () => {
    await upsertUser({ userId: USER_ROW.user_id, username: 'nested', seenAt: '2026-08-02T00:00:00.000Z' });
  });
  const row = getStore().table(TABLE_NAMES.GLOBAL_USERS).get(USER_ROW.user_id);
  assert.equal(row.username, 'nested');
  assert.equal(row.first_seen_at, '2026-08-02T00:00:00.000Z');
});

test('mutations outside a transaction are forbidden', () => {
  const table = getStore().table(TABLE_NAMES.GLOBAL_USERS);
  assert.throws(() => table.insert({ ...USER_ROW }), /require a transaction/);
  assert.throws(() => table.delete(USER_ROW.user_id), /require a transaction/);
});

test('insert conflict throws ConflictError; update of missing row throws NotFoundError', async () => {
  await withTransaction((tx) => {
    tx.table(TABLE_NAMES.GLOBAL_USERS).insert({ ...USER_ROW });
    assert.throws(() => tx.table(TABLE_NAMES.GLOBAL_USERS).insert({ ...USER_ROW }), ConflictError);
    assert.throws(
      () => tx.table(TABLE_NAMES.GLOBAL_USERS).update('200000000000000999', { username: 'x' }),
      NotFoundError,
    );
  });
});

test('data survives store reopen (atomic flush + reload)', async () => {
  await withTransaction((tx) => {
    tx.table(TABLE_NAMES.GLOBAL_USERS).insert({ ...USER_ROW });
  });
  await getStore().flushAll();
  await destroyTestStore();

  await initStore({ dataDir: dir, flushDebounceMs: 0 });
  const row = getStore().table(TABLE_NAMES.GLOBAL_USERS).get(USER_ROW.user_id);
  assert.equal(row.username, 'alice');
});

test('corrupt store file recovers from .bak', async () => {
  await withTransaction((tx) => {
    tx.table(TABLE_NAMES.GLOBAL_USERS).insert({ ...USER_ROW });
  });
  await getStore().flushAll();
  await withTransaction((tx) => {
    tx.table(TABLE_NAMES.GLOBAL_USERS).update(USER_ROW.user_id, { username: 'v2' });
  });
  await getStore().flushAll(); // second flush creates the .bak
  await destroyTestStore();

  fs.writeFileSync(path.join(dir, `${TABLE_NAMES.GLOBAL_USERS}.json`), '{corrupt json!', 'utf8');

  await initStore({ dataDir: dir, flushDebounceMs: 0 });
  const row = getStore().table(TABLE_NAMES.GLOBAL_USERS).get(USER_ROW.user_id);
  assert.ok(row, 'row recovered from backup');
  assert.equal(row.username, 'alice');
  await destroyTestStore();
});

test('auto-increment ids increase monotonically', async () => {
  await withTransaction((tx) => {
    const table = tx.table(TABLE_NAMES.AGGREGATION_QUEUE);
    table.insert({ id: table.nextId(), job_type: 'RECALC_REPUTATION' });
    table.insert({ id: table.nextId(), job_type: 'RECALC_REPUTATION' });
  });
  const jobs = getStore().table(TABLE_NAMES.AGGREGATION_QUEUE).toArray();
  assert.deepEqual(jobs.map((j) => j.id), ['1', '2']);
});

test('unknown table and uninitialised store raise StorageError', async () => {
  assert.throws(() => getStore().table('nope'), StorageError);
  await destroyTestStore();
  assert.throws(() => getStore().table(TABLE_NAMES.GLOBAL_USERS), StorageError);
  // re-init so afterEach can close cleanly
  await initStore({ dataDir: dir, flushDebounceMs: 0 });
});

test('healthCheck reports driver status', async () => {
  const health = await getStore().healthCheck();
  assert.equal(health.driver, 'json');
  assert.equal(health.closed, false);
  assert.ok(health.tables >= 20);
});
