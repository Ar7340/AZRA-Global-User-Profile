import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  createTestStore, destroyTestStore, registerGuild, joinGuild, messageActivity,
  G, G2, U1, U2, U3, event,
} from './helpers.js';
import { ingestEvent } from '../src/events/processor.js';
import { EVENT_TYPES } from '../src/domain/catalog.js';
import * as aggregationQueue from '../src/models/aggregationQueue.model.js';
import * as globalActivity from '../src/models/globalActivity.model.js';
import * as globalReputation from '../src/models/globalReputation.model.js';
import * as globalVerification from '../src/models/globalVerification.model.js';
import {
  runAggregationPass, computeReputationLevel, REPUTATION_WEIGHTS,
} from '../src/services/aggregationService.js';

beforeEach(async () => {
  await createTestStore('agg-test');
});

afterEach(async () => {
  await destroyTestStore();
});

test('enqueue dedupes pending jobs of the same type+entity', async () => {
  const a = await aggregationQueue.enqueue({ jobType: 'RECALC_REPUTATION', entityType: 'USER', entityId: U1 });
  assert.equal(a.queued, true);
  const b = await aggregationQueue.enqueue({ jobType: 'RECALC_REPUTATION', entityType: 'USER', entityId: U1 });
  assert.equal(b.queued, false);
  assert.equal(await aggregationQueue.countPending(), 1);
});

test('contributing-guild recalc only counts participating, permitted guilds', async () => {
  await registerGuild(G, { level: 'FULL' });
  await registerGuild(G2, { level: 'STANDARD' }); // ACTIVITY allowed
  await joinGuild(G, U1);
  await joinGuild(G2, U1);
  await messageActivity(G, U1, 10);
  await messageActivity(G2, U1, 4);

  await runAggregationPass(); // drains RECALC_CONTRIBUTING_GUILDS for U1
  const totals = await globalActivity.getTotals(U1);
  assert.equal(totals.contributing_guilds, 2);
  assert.equal(totals.messages_seen, 14);

  // Guild B revokes ACTIVITY sharing → only G contributes now.
  await ingestEvent(event(EVENT_TYPES.GUILD_UPDATE, { dataSharingLevel: 'MINIMAL' }, { guildId: G2 }));
  await runAggregationPass();
  await runAggregationPass(); // REBUILD_GUILD_AGGREGATES enqueues user recalc
  const after = await globalActivity.getTotals(U1);
  assert.equal(after.contributing_guilds, 1);
  assert.equal(after.messages_seen, 10, 'global totals exclude revoked sources');
});

test('reputation levels follow the documented thresholds', () => {
  assert.equal(computeReputationLevel(-100), 'FLAGGED');
  assert.equal(computeReputationLevel(-50), 'FLAGGED');
  assert.equal(computeReputationLevel(0), 'NEW');
  assert.equal(computeReputationLevel(14), 'NEW');
  assert.equal(computeReputationLevel(15), 'ESTABLISHED');
  assert.equal(computeReputationLevel(75), 'TRUSTED');
  assert.equal(computeReputationLevel(150), 'EXEMPLARY');
});

test('reputation reflects scoped moderation and verification', async () => {
  await registerGuild(G, { level: 'FULL' });
  await registerGuild(G2, { level: 'STANDARD' }); // MODERATION not shared
  await joinGuild(G, U2);
  await joinGuild(G2, U2);
  await messageActivity(G2, U2, 1); // makes G2 "active" for U2

  // Warn in the sharing guild + ban in the non-sharing guild (must be ignored).
  await ingestEvent(event(EVENT_TYPES.MODERATION_ACTION, { actionType: 'WARN' }, { guildId: G, userId: U2 }));
  await ingestEvent(event(EVENT_TYPES.MODERATION_ACTION, { actionType: 'BAN' }, { guildId: G2, userId: U2 }));
  await ingestEvent(event(EVENT_TYPES.VERIFICATION_COMPLETED, { method: 'CAPTCHA' }, { guildId: G, userId: U2 }));

  await runAggregationPass();
  await runAggregationPass();

  const rep = await globalReputation.getReputation(U2);
  // 1 verified guild (15) - 1 warn (3) = 12 → NEW
  assert.equal(rep.reputation_score, REPUTATION_WEIGHTS.perVerifiedGuild - REPUTATION_WEIGHTS.warnPenalty);
  assert.equal(rep.level, 'NEW');
  assert.equal(rep.breakdown.BAN ?? 0, 0, 'ban in non-sharing guild must not count');
  assert.equal(rep.breakdown.WARN, 1);
});

test('global verification aggregates only authorized guild verifications', async () => {
  await registerGuild(G, { level: 'FULL' });
  await registerGuild(G2, { level: 'STANDARD' }); // VERIFICATION allowed
  await joinGuild(G, U3);
  await joinGuild(G2, U3);
  await ingestEvent(event(EVENT_TYPES.VERIFICATION_COMPLETED, { method: 'CAPTCHA' }, { guildId: G, userId: U3 }));
  await ingestEvent(event(EVENT_TYPES.VERIFICATION_COMPLETED, { method: 'ROLE' }, { guildId: G2, userId: U3 }));

  await runAggregationPass();
  const verification = await globalVerification.getVerification(U3);
  assert.equal(verification.status, 'VERIFIED');
  assert.equal(verification.highest_level, 'CROSS_GUILD');
  assert.equal(verification.confirming_guilds, 2);
});

test('failed jobs back off and eventually fail permanently', async () => {
  const { queued, job } = await aggregationQueue.enqueue({
    jobType: 'RECALC_REPUTATION', entityType: 'USER', entityId: U1,
  });
  assert.ok(queued);
  const claimed = await aggregationQueue.claimBatch({ limit: 5, workerId: 'test' });
  assert.equal(claimed.length, 1);
  await aggregationQueue.fail(job.id, new Error('transient'));
  let rows = await aggregationQueue.listJobs({});
  assert.equal(rows[0].status, 'PENDING');
  assert.equal(rows[0].attempts, 1);
  assert.ok(rows[0].run_after > new Date().toISOString(), 'backoff pushes run_after into the future');

  // Exhaust the budget (env default: 5 attempts), fast-forwarding the
  // backoff window between attempts the way real elapsed time would.
  for (let i = 0; i < 10; i += 1) {
    const { withTransaction } = await import('../src/db/index.js');
    const { TABLE_NAMES } = await import('../src/db/json/schema.js');
    await withTransaction((tx) => {
      tx.table(TABLE_NAMES.AGGREGATION_QUEUE).update(String(job.id), {
        run_after: '2020-01-01T00:00:00.000Z',
      });
    });
    const batch = await aggregationQueue.claimBatch({ limit: 5, workerId: 'test' });
    if (batch.length === 0) break;
    await aggregationQueue.fail(job.id, new Error('transient'));
  }
  rows = await aggregationQueue.listJobs({});
  assert.equal(rows[0].status, 'FAILED');
  assert.match(rows[0].last_error, /transient/);
});

test('stuck RUNNING jobs are requeued by the recovery pass', async () => {
  await aggregationQueue.enqueue({ jobType: 'RECALC_REPUTATION', entityType: 'USER', entityId: U1 });
  await aggregationQueue.claimBatch({ limit: 5, workerId: 'dead-worker' });
  // Simulate a crashed worker by backdating the lock.
  const { withTransaction } = await import('../src/db/index.js');
  const { TABLE_NAMES } = await import('../src/db/json/schema.js');
  await withTransaction((tx) => {
    tx.table(TABLE_NAMES.AGGREGATION_QUEUE).update('1', {
      locked_at: '2020-01-01T00:00:00.000Z',
    });
  });
  const requeued = await aggregationQueue.requeueStuck({ olderThanMs: 60_000 });
  assert.equal(requeued, 1);
  assert.equal(await aggregationQueue.countPending(), 1);
});

test('runAggregationPass drains the queue and reports counts', async () => {
  await registerGuild(G);
  await joinGuild(G, U1);
  await messageActivity(G, U1, 1);
  let report = await runAggregationPass();
  assert.ok(report.claimed >= 1);
  assert.equal(report.failed, 0);
  report = await runAggregationPass();
  assert.equal(report.claimed, 0, 'queue fully drained');
  assert.equal(await aggregationQueue.countPending(), 0);
});

