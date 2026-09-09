import { getStore } from './db/index.js';

/** Lightweight readiness probe for the storage layer. */
export async function healthCheck() {
  const store = getStore();
  const health = await store.healthCheck();
  return { ok: !health.closed, ...health };
}
