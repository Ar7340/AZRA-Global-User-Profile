import { AsyncLocalStorage } from 'node:async_hooks';
import { TABLE_SCHEMAS } from './schema.js';
import { JsonTable, ReadOnlyTable, TxTable } from './table.js';
import { JsonPersistence } from './persistence.js';
import { StorageError } from '../../utils/errors.js';
import { logger } from '../../utils/logger.js';

const log = logger.child('store');

/** Serializes transactions; JSON state is in-memory and single-process. */
class Mutex {
  #tail = Promise.resolve();

  async run(fn) {
    const prev = this.#tail;
    let release;
    this.#tail = new Promise((resolve) => {
      release = resolve;
    });
    await prev;
    try {
      return await fn();
    } finally {
      release();
    }
  }
}

/**
 * Transaction context. Mutations made through tx.table(name) are journalled;
 * rollback() restores the exact prior state of every touched row.
 */
export class Transaction {
  #journal = [];

  constructor(driver) {
    this.driver = driver;
    this.touchedTables = new Set();
  }

  table(name) {
    const raw = this.driver.rawTable(name);
    this.touchedTables.add(name);
    return new TxTable(raw, this.#journal);
  }

  rollback() {
    for (let i = this.#journal.length - 1; i >= 0; i -= 1) {
      const entry = this.#journal[i];
      if (entry.existed) entry.raw._put(entry.pk, entry.prevRow);
      else entry.raw._delete(entry.pk);
    }
    this.#journal.length = 0;
  }
}

/**
 * JSON storage driver.
 *
 * - Loads every table into memory on init (development scale).
 * - `withTransaction(fn)` serializes transactions, joins nested calls via
 *   AsyncLocalStorage (model helpers called inside an outer transaction
 *   automatically join it instead of deadlocking), journals mutations and
 *   marks touched tables dirty for the debounced flusher.
 */
export class JsonDriver {
  #tables = new Map();
  #persistence;
  #als = new AsyncLocalStorage();
  #mutex = new Mutex();
  #closed = false;

  constructor({ dataDir, flushDebounceMs } = {}) {
    this.dataDir = dataDir;
    this.flushDebounceMs = flushDebounceMs;
    this.#persistence = new JsonPersistence({
      dataDir,
      debounceMs: flushDebounceMs,
    });
  }

  async init() {
    const { mkdir } = await import('node:fs/promises');
    await mkdir(this.dataDir, { recursive: true });
    for (const [name, def] of Object.entries(TABLE_SCHEMAS)) {
      const state = await this.#persistence.load(name, def);
      this.#tables.set(name, new JsonTable(name, def, state));
    }
    log.debug('json store initialised', { dataDir: this.dataDir, tables: this.#tables.size });
  }

  rawTable(name) {
    const table = this.#tables.get(name);
    if (!table) throw new StorageError(`Unknown table "${name}"`);
    return table;
  }

  /** Read-only access outside transactions. */
  table(name) {
    return new ReadOnlyTable(this.rawTable(name));
  }

  async withTransaction(fn) {
    const active = this.#als.getStore();
    if (active) return fn(active); // join the outer transaction
    if (this.#closed) throw new StorageError('Store is closed');
    return this.#mutex.run(async () => {
      const tx = new Transaction(this);
      return this.#als.run(tx, async () => {
        try {
          const result = await fn(tx);
          if (tx.touchedTables.size > 0) this.#persistence.markDirty(tx.touchedTables);
          return result;
        } catch (err) {
          tx.rollback();
          throw err;
        }
      });
    });
  }

  async flushAll() {
    return this.#persistence.flush(this.#tables);
  }

  async close() {
    this.#closed = true;
    await this.#persistence.close(this.#tables);
  }

  async healthCheck() {
    let rows = 0;
    for (const table of this.#tables.values()) rows += table.size;
    return {
      driver: 'json',
      dataDir: this.dataDir,
      tables: this.#tables.size,
      rows,
      pendingDirty: this.#persistence.pendingDirty,
      closed: this.#closed,
    };
  }
}
