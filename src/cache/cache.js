import { env } from '../config/env.js';

/**
 * Small in-process TTL cache with insertion-order eviction.
 *
 * The JSON development store keeps hot rows in memory anyway; this cache
 * exists so the service layer has a stable caching contract that maps 1:1
 * onto Redis when the system scales out (swap the implementation, keep the
 * call sites).
 */
export class TtlCache {
  #map = new Map();

  constructor({ ttlMs = env.cache.ttlMs, maxKeys = env.cache.maxKeys } = {}) {
    this.ttlMs = ttlMs;
    this.maxKeys = maxKeys;
  }

  get(key) {
    const entry = this.#map.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.#map.delete(key);
      return undefined;
    }
    // refresh insertion order (LRU-ish)
    this.#map.delete(key);
    this.#map.set(key, entry);
    return entry.value;
  }

  set(key, value, { ttlMs } = {}) {
    if (this.#map.size >= this.maxKeys && !this.#map.has(key)) {
      const oldest = this.#map.keys().next().value;
      this.#map.delete(oldest);
    }
    this.#map.set(key, { value, expiresAt: Date.now() + (ttlMs ?? this.ttlMs) });
    return value;
  }

  delete(key) {
    return this.#map.delete(key);
  }

  has(key) {
    return this.get(key) !== undefined;
  }

  invalidatePrefix(prefix) {
    let removed = 0;
    for (const key of [...this.#map.keys()]) {
      if (key.startsWith(prefix)) {
        this.#map.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  clear() {
    this.#map.clear();
  }

  get size() {
    return this.#map.size;
  }

  async wrap(key, loader, { ttlMs } = {}) {
    const hit = this.get(key);
    if (hit !== undefined) return hit;
    const value = await loader();
    this.set(key, value, { ttlMs });
    return value;
  }
}

export const cache = new TtlCache();

export const CACHE_KEYS = {
  userSummary: (userId) => `user:summary:${userId}`,
  guildUserSummary: (guildId, userId) => `guild:summary:${guildId}:${userId}`,
  participating: 'guilds:participating',
};

export function invalidateUserCache(userId) {
  if (userId != null) cache.delete(CACHE_KEYS.userSummary(userId));
}

export function invalidateGuildCache(guildId) {
  if (guildId != null) cache.invalidatePrefix(`guild:summary:${guildId}:`);
  cache.delete(CACHE_KEYS.participating);
}
