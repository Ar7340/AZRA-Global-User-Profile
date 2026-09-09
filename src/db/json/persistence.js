import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { StorageError } from '../../utils/errors.js';
import { logger } from '../../utils/logger.js';

const log = logger.child('persistence');

/**
 * Atomic JSON file persistence.
 *
 * - Writes go to `<table>.json.tmp`, then `rename()` over the target file
 *   (Node's rename replaces existing files on Windows and POSIX).
 * - The previous version is kept as `<table>.json.bak` and used for recovery
 *   if the main file is ever found corrupt.
 * - Debounced flushing coalesces bursts of writes into one disk pass.
 * - Flushes are serialized through a promise chain to prevent tmp-file races.
 */
export class JsonPersistence {
  #dirty = new Set();
  #timer = null;
  #writeChain = Promise.resolve();

  constructor({ dataDir, debounceMs }) {
    this.dataDir = dataDir;
    this.debounceMs = debounceMs;
  }

  filePath(name) {
    return path.join(this.dataDir, `${name}.json`);
  }

  async load(name, def) {
    const file = this.filePath(name);
    if (!fs.existsSync(file)) {
      return {
        meta: { version: 1, autoIncrement: def.autoIncrement ? 0 : null },
        rows: [],
      };
    }

    let parsed = null;
    try {
      parsed = JSON.parse(await fsp.readFile(file, 'utf8'));
    } catch (err) {
      const backup = `${file}.bak`;
      if (fs.existsSync(backup)) {
        log.warn(`corrupt store file for "${name}", recovering from backup`, {
          error: err.message,
        });
        parsed = JSON.parse(await fsp.readFile(backup, 'utf8'));
      } else {
        throw new StorageError(`Failed to load store file for "${name}"`, { cause: err });
      }
    }

    const rows = Array.isArray(parsed?.rows) ? parsed.rows : [];
    const meta = parsed?.meta ?? { version: 1, autoIncrement: def.autoIncrement ? 0 : null };
    return { meta, rows };
  }

  markDirty(tableNames) {
    for (const name of tableNames) this.#dirty.add(name);
    this.#schedule();
  }

  #schedule() {
    if (this.debounceMs <= 0) {
      // Immediate flush (used by tests and seed); still async-safe via chain.
      this.flushSoon();
      return;
    }
    if (this.#timer) return;
    this.#timer = setTimeout(() => {
      this.#timer = null;
      this.flushSoon();
    }, this.debounceMs);
    this.#timer.unref?.();
  }

  flushSoon() {
    this.#writeChain = this.#writeChain.then(() => {}, () => {});
  }

  /**
   * Writes every dirty table to disk. `tables` is the Map<name, JsonTable>
   * owned by the driver.
   */
  async flush(tables) {
    if (this.#timer) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
    const names = [...this.#dirty];
    this.#dirty.clear();
    if (names.length === 0) return 0;

    const run = async () => {
      let written = 0;
      for (const name of names) {
        const table = tables.get(name);
        if (!table) continue;
        await this.#writeAtomic(name, table.serialize());
        written += 1;
      }
      return written;
    };

    const result = this.#writeChain.then(run, run);
    this.#writeChain = result.then(() => {}, () => {});
    return result;
  }

  async #writeAtomic(name, payload) {
    const file = this.filePath(name);
    const tmp = `${file}.tmp`;
    const body = JSON.stringify(payload);
    try {
      await fsp.writeFile(tmp, body, 'utf8');
      if (fs.existsSync(file)) {
        try {
          await fsp.copyFile(file, `${file}.bak`);
        } catch (err) {
          log.warn(`could not back up "${name}"`, { error: err.message });
        }
      }
      await fsp.rename(tmp, file);
    } catch (err) {
      // Re-mark dirty so a later flush retries the write.
      this.#dirty.add(name);
      throw new StorageError(`Failed to persist table "${name}"`, { cause: err });
    }
  }

  async close(tables) {
    if (this.#timer) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
    await this.flush(tables);
  }

  get pendingDirty() {
    return this.#dirty.size;
  }
}
