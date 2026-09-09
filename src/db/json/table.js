import { ConflictError, NotFoundError, StorageError } from '../../utils/errors.js';

/**
 * Raw mutable table state: rows keyed by primary key plus meta (version,
 * auto-increment counter). Only TxTable may mutate it — direct mutation
 * methods are prefixed with `_` and reserved for the transaction layer so
 * every write is journalled and persisted.
 */
export class JsonTable {
  #rows = new Map();
  #meta;

  constructor(name, def, state = null) {
    this.name = name;
    this.def = def;
    this.#meta = state?.meta ?? {
      version: 1,
      autoIncrement: def.autoIncrement ? 0 : null,
    };
    if (state?.rows) {
      for (const row of state.rows) this.#rows.set(def.pk(row), row);
    }
  }

  get meta() {
    return this.#meta;
  }

  get size() {
    return this.#rows.size;
  }

  pkOf(row) {
    return this.def.pk(row);
  }

  get(pk) {
    return this.#rows.get(pk);
  }

  has(pk) {
    return this.#rows.has(pk);
  }

  keys() {
    return this.#rows.keys();
  }

  values() {
    return this.#rows.values();
  }

  toArray() {
    return [...this.#rows.values()];
  }

  *filter(predicate) {
    for (const row of this.#rows.values()) {
      if (predicate(row)) yield row;
    }
  }

  find(predicate) {
    for (const row of this.#rows.values()) {
      if (predicate(row)) return row;
    }
    return undefined;
  }

  count(predicate) {
    let n = 0;
    for (const row of this.#rows.values()) {
      if (!predicate || predicate(row)) n += 1;
    }
    return n;
  }

  sum(field, predicate) {
    let total = 0;
    for (const row of this.#rows.values()) {
      if (!predicate || predicate(row)) total += Number(row[field] ?? 0);
    }
    return total;
  }

  nextId() {
    if (!this.def.autoIncrement) {
      throw new StorageError(`Table "${this.name}" does not use auto-increment ids`);
    }
    this.#meta.autoIncrement += 1;
    return String(this.#meta.autoIncrement);
  }

  _insert(pk, row) {
    if (this.#rows.has(pk)) {
      throw new ConflictError(`Row "${pk}" already exists in "${this.name}"`);
    }
    this.#rows.set(pk, row);
  }

  _put(pk, row) {
    this.#rows.set(pk, row);
  }

  _delete(pk) {
    return this.#rows.delete(pk);
  }

  serialize() {
    return { meta: this.#meta, rows: this.toArray() };
  }
}

/**
 * Read-only view returned by driver.table() outside transactions. Reads are
 * always safe; writes throw to guarantee every mutation is journalled.
 */
export class ReadOnlyTable {
  constructor(raw) {
    this.raw = raw;
    this.name = raw.name;
  }

  get size() {
    return this.raw.size;
  }

  get(pk) {
    return this.raw.get(pk);
  }

  has(pk) {
    return this.raw.has(pk);
  }

  keys() {
    return this.raw.keys();
  }

  values() {
    return this.raw.values();
  }

  toArray() {
    return this.raw.toArray();
  }

  filter(predicate) {
    return this.raw.filter(predicate);
  }

  find(predicate) {
    return this.raw.find(predicate);
  }

  count(predicate) {
    return this.raw.count(predicate);
  }

  sum(field, predicate) {
    return this.raw.sum(field, predicate);
  }

  pkOf(row) {
    return this.raw.pkOf(row);
  }

  #forbidden() {
    throw new StorageError(
      `Mutations on "${this.name}" require a transaction (use withTransaction / model helpers)`,
    );
  }

  get insert() {
    return this.#forbidden;
  }

  get put() {
    return this.#forbidden;
  }

  get update() {
    return this.#forbidden;
  }

  get delete() {
    return this.#forbidden;
  }

  get nextId() {
    return this.#forbidden;
  }
}

/**
 * Transactional table view. Records an undo journal entry before each
 * mutation so Transaction.rollback() can restore prior state exactly.
 */
export class TxTable {
  constructor(raw, journal) {
    this.raw = raw;
    this.name = raw.name;
    this.#journal = journal;
  }

  #journal;

  get size() {
    return this.raw.size;
  }

  get(pk) {
    return this.raw.get(pk);
  }

  has(pk) {
    return this.raw.has(pk);
  }

  values() {
    return this.raw.values();
  }

  toArray() {
    return this.raw.toArray();
  }

  filter(predicate) {
    return this.raw.filter(predicate);
  }

  find(predicate) {
    return this.raw.find(predicate);
  }

  count(predicate) {
    return this.raw.count(predicate);
  }

  sum(field, predicate) {
    return this.raw.sum(field, predicate);
  }

  pkOf(row) {
    return this.raw.pkOf(row);
  }

  #record(pk) {
    this.#journal.push({
      raw: this.raw,
      pk,
      existed: this.raw.has(pk),
      prevRow: this.raw.get(pk),
    });
  }

  insert(row) {
    const pk = this.raw.pkOf(row);
    this.#record(pk);
    this.raw._insert(pk, row);
    return row;
  }

  put(row) {
    const pk = this.raw.pkOf(row);
    this.#record(pk);
    this.raw._put(pk, row);
    return row;
  }

  update(pk, patch) {
    const prev = this.raw.get(pk);
    if (!prev) {
      throw new NotFoundError(`Row "${pk}" not found in "${this.name}"`);
    }
    this.#record(pk);
    const next = { ...prev, ...patch };
    this.raw._put(pk, next);
    return next;
  }

  delete(pk) {
    if (!this.raw.has(pk)) return false;
    this.#record(pk);
    return this.raw._delete(pk);
  }

  nextId() {
    return this.raw.nextId();
  }
}
