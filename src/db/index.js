import { env } from '../config/env.js';
import { JsonDriver } from './json/driver.js';
import { StorageError, UnsupportedDriverError } from '../utils/errors.js';

/**
 * Storage singleton.
 *
 * Models call getStore()/withTransaction() at operation time (never import
 * the instance at module scope) so tests and scripts can re-point the store
 * at a different data directory.
 */
let active = null;

export function getStore() {
  if (!active) {
    throw new StorageError('Store not initialised — call initStore() first');
  }
  return active;
}

export async function initStore(options = {}) {
  if (active) await closeStore();

  if (env.driver !== 'json') {
    throw new UnsupportedDriverError(
      `Driver "${env.driver}" is reserved for the production MySQL swap. ` +
        'The schema is already authored in src/migrations/001_global_profile_schema.sql; ' +
        'only the JSON driver ships in this foundation.',
    );
  }

  const driver = new JsonDriver({
    dataDir: options.dataDir ?? env.dataDir,
    flushDebounceMs: options.flushDebounceMs ?? env.flushDebounceMs,
  });
  await driver.init();
  active = driver;
  return driver;
}

export async function closeStore() {
  if (!active) return;
  const driver = active;
  active = null;
  await driver.close();
}

/** Runs `fn(tx)` in a transaction, joining any transaction already active on
 *  this async context (nested model calls never deadlock). */
export function withTransaction(fn) {
  return getStore().withTransaction(fn);
}
