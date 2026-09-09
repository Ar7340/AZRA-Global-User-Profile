import { withTransaction, getStore } from '../db/index.js';
import { TABLE_NAMES } from '../db/json/schema.js';
import { nowIso, toIso, addMinutesIso } from '../utils/dates.js';
import { env } from '../config/env.js';

const T = TABLE_NAMES.AGGREGATION_QUEUE;
const BACKOFF_BASE_MINUTES = 2;
const BACKOFF_CAP_MINUTES = 30;

/**
 * Durable background job queue for aggregation work. enqueue() dedupes
 * pending jobs of the same type+entity so bursty event traffic cannot
 * flood the queue. claimBatch() uses the (priority, id) order — the JSON
 * equivalent of FOR UPDATE SKIP LOCKED.
 */
export async function enqueue({ jobType, entityType, entityId, priority = 5, runAfter = null }) {
  return withTransaction((tx) => {
    const table = tx.table(T);
    const pending = table.find(
      (r) => r.job_type === jobType && r.entity_id === String(entityId) && r.status === 'PENDING',
    );
    if (pending) return { queued: false, job: pending };

    const job = {
      id: table.nextId(),
      job_type: jobType,
      entity_type: entityType,
      entity_id: String(entityId),
      priority,
      status: 'PENDING',
      attempts: 0,
      max_attempts: env.aggregation.maxAttempts,
      run_after: toIso(runAfter) ?? nowIso(),
      locked_by: null,
      locked_at: null,
      last_error: null,
      created_at: nowIso(),
      completed_at: null,
    };
    table.insert(job);
    return { queued: true, job };
  });
}

export async function claimBatch({ limit = env.aggregation.batchSize, workerId = 'worker' } = {}) {
  return withTransaction((tx) => {
    const table = tx.table(T);
    const now = nowIso();
    const ready = [...table.filter((r) => r.status === 'PENDING' && r.run_after <= now)]
      .sort((a, b) => a.priority - b.priority || Number(a.id) - Number(b.id))
      .slice(0, limit);

    return ready.map((job) => table.update(String(job.id), {
      status: 'RUNNING',
      locked_by: workerId,
      locked_at: now,
    }));
  });
}

export async function complete(id) {
  return withTransaction((tx) => tx.table(T).update(String(id), {
    status: 'DONE',
    completed_at: nowIso(),
    last_error: null,
  }));
}

export async function fail(id, error, { maxAttempts = env.aggregation.maxAttempts } = {}) {
  return withTransaction((tx) => {
    const table = tx.table(T);
    const job = table.get(String(id));
    if (!job) return null;
    const attempts = job.attempts + 1;
    const exhausted = attempts >= maxAttempts;
    const backoffMinutes = Math.min(
      BACKOFF_CAP_MINUTES,
      BACKOFF_BASE_MINUTES * 2 ** (attempts - 1),
    );
    return table.update(String(id), {
      status: exhausted ? 'FAILED' : 'PENDING',
      attempts,
      run_after: exhausted ? job.run_after : addMinutesIso(nowIso(), backoffMinutes),
      last_error: String(error?.message ?? error).slice(0, 512),
      locked_by: null,
      locked_at: null,
    });
  });
}

export async function countPending() {
  return getStore().table(T).count((r) => r.status === 'PENDING');
}

/** Crash recovery: RUNNING jobs whose lock has expired go back to PENDING. */
export async function requeueStuck({ olderThanMs = 5 * 60_000 } = {}) {
  return withTransaction((tx) => {
    const table = tx.table(T);
    const cutoff = new Date(Date.now() - olderThanMs).toISOString();
    let requeued = 0;
    for (const job of table.filter((r) => r.status === 'RUNNING' && r.locked_at && r.locked_at < cutoff)) {
      table.update(String(job.id), { status: 'PENDING', locked_by: null, locked_at: null });
      requeued += 1;
    }
    return requeued;
  });
}

export async function listJobs({ status = null, limit = 50 } = {}) {
  const rows = getStore().table(T).toArray();
  const filtered = status ? rows.filter((r) => r.status === status) : rows;
  return filtered.sort((a, b) => Number(a.id) - Number(b.id)).slice(0, limit);
}
