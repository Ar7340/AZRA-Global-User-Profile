import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { buildGenerationPlan, INTENSITY_PRESETS, BADGE_POOL, WARN_REASONS } from '../bot/randomData.js';
import { validateEvent } from '../src/events/validators.js';
import { createTestStore, destroyTestStore, registerGuild, G, G2, U1, U2 } from './helpers.js';
import { ingestEvent } from '../src/events/processor.js';
import { runAggregationPass } from '../src/services/aggregationService.js';
import * as globalActivity from '../src/models/globalActivity.model.js';
import * as globalBadges from '../src/models/globalBadges.model.js';
import * as globalVerification from '../src/models/globalVerification.model.js';

const NOW = Date.parse('2026-08-20T12:00:00.000Z');

/** Deterministic LCG so plan shapes are reproducible in tests. */
function seededRng(seed = 42) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

describe('buildGenerationPlan', () => {
  test('respects intensity caps and composes extras correctly', () => {
    const light = buildGenerationPlan({ guildId: G, userId: U1, days: 14, intensity: 'light', now: NOW, rng: seededRng() });
    const normal = buildGenerationPlan({ guildId: G, userId: U1, days: 14, intensity: 'normal', now: NOW, rng: seededRng() });
    const heavy = buildGenerationPlan({ guildId: G, userId: U1, days: 14, intensity: 'heavy', now: NOW, rng: seededRng() });

    assert.equal(light.events.length, INTENSITY_PRESETS.light.activityEvents + 2); // + verify + badge
    assert.equal(normal.events.length, INTENSITY_PRESETS.normal.activityEvents + 3); // + verify + badge + warn
    assert.equal(heavy.events.length, INTENSITY_PRESETS.heavy.activityEvents + 3);

    assert.ok(!light.summary.extras.includes('warn'), 'light preset excludes moderation');
    assert.ok(normal.summary.extras.includes('warn'));
    assert.ok(heavy.summary.extras.includes('warn'));

    assert.equal(light.summary.total, INTENSITY_PRESETS.light.activityEvents + 2);
  });

  test('every generated event passes pipeline validation', () => {
    const plan = buildGenerationPlan({ guildId: G, userId: U1, days: 30, intensity: 'heavy', now: NOW, rng: seededRng() });
    for (const event of plan.events) {
      const validated = validateEvent(event); // throws on any violation
      assert.equal(validated.guildId, G);
      assert.equal(validated.userId, U1);
    }
  });

  test('occurredAt values stay inside the requested day window and never in the future', () => {
    const days = 7;
    const plan = buildGenerationPlan({ guildId: G, userId: U1, days, intensity: 'light', now: NOW, rng: seededRng() });
    for (const event of plan.events) {
      const age = NOW - Date.parse(event.occurredAt);
      assert.ok(age >= 0, 'no future timestamps');
      assert.ok(age <= days * 86_400_000, `event older than ${days} days: ${age}`);
    }
  });

  test('is deterministic under a seeded rng', () => {
    const a = buildGenerationPlan({ guildId: G, userId: U1, days: 14, intensity: 'normal', now: NOW, rng: seededRng(7) });
    const b = buildGenerationPlan({ guildId: G, userId: U1, days: 14, intensity: 'normal', now: NOW, rng: seededRng(7) });
    assert.deepEqual(a.summary, b.summary);
    assert.equal(a.events.length, b.events.length);
    for (let i = 0; i < a.events.length; i += 1) {
      assert.equal(a.events[i].type, b.events[i].type);
      assert.equal(a.events[i].occurredAt, b.events[i].occurredAt);
      assert.equal(a.events[i].payload.amount, b.events[i].payload.amount);
      assert.equal(a.events[i].eventId, b.events[i].eventId, 'same seed + same runId = identical plan');
    }
  });

  test('a different runId produces different event ids (repeated runs ADD data)', () => {
    const a = buildGenerationPlan({ guildId: G, userId: U1, days: 14, intensity: 'normal', now: NOW, rng: seededRng(7), runId: 'run-a' });
    const b = buildGenerationPlan({ guildId: G, userId: U1, days: 14, intensity: 'normal', now: NOW, rng: seededRng(7), runId: 'run-b' });
    assert.equal(a.events.length, b.events.length);
    assert.notEqual(a.events[0].eventId, b.events[0].eventId);
  });

  test('badge and warn pools are used', () => {
    const seenBadges = new Set();
    const seenWarns = new Set();
    for (let seed = 1; seed <= 8; seed += 1) {
      const plan = buildGenerationPlan({ guildId: G, userId: U1, days: 5, intensity: 'normal', now: NOW, rng: seededRng(seed) });
      for (const extra of plan.summary.extras) {
        if (extra.startsWith('badge:')) seenBadges.add(extra.slice(6));
        if (extra === 'warn') {
          const warn = plan.events.find((e) => e.type === 'MODERATION_ACTION');
          seenWarns.add(warn.payload.reason);
        }
      }
    }
    for (const badge of seenBadges) assert.ok(BADGE_POOL.includes(badge));
    for (const reason of seenWarns) assert.ok(WARN_REASONS.includes(reason));
  });
});

describe('generation pipeline', () => {
  beforeEach(async () => {
    await createTestStore('gen-test');
  });

  afterEach(async () => {
    await destroyTestStore();
  });

  test('generated events process through the pipeline and update aggregates', async () => {
    await registerGuild(G, { level: 'FULL' });
    const plan = buildGenerationPlan({
      guildId: G, userId: U1, days: 14, intensity: 'light', now: Date.now(), rng: seededRng(), runId: 't1',
    });

    let processed = 0;
    for (const event of plan.events) {
      const result = await ingestEvent(event);
      assert.equal(result.status, 'processed');
      processed += 1;
    }
    assert.equal(processed, plan.events.length);

    const totals = await globalActivity.getTotals(U1);
    assert.ok(totals.messages_seen > 0, 'messages counted');
    assert.ok(totals.reactions_added > 0, 'reactions counted');

    await runAggregationPass();
    const aggregated = await globalActivity.getTotals(U1);
    assert.equal(aggregated.contributing_guilds, 1);
    assert.equal(await globalBadges.countActiveBadges(U1), 1, 'badge landed');

    const verification = await globalVerification.getVerification(U1);
    assert.equal(verification.status, 'VERIFIED');
    assert.equal(verification.confirming_guilds, 1);

    // Daily buckets spread across the window.
    assert.ok(aggregated.active_days >= 1);
  });

  test('generation in a non-participating guild is fully gated', async () => {
    await registerGuild(G2, { level: 'NONE', name: 'Silent' });
    const plan = buildGenerationPlan({
      guildId: G2, userId: U2, days: 7, intensity: 'light', now: Date.now(), rng: seededRng(), runId: 't2',
    });

    let skipped = 0;
    for (const event of plan.events) {
      const result = await ingestEvent(event);
      assert.equal(result.status, 'skipped');
      skipped += 1;
    }
    assert.equal(skipped, plan.events.length);
    assert.equal(await globalActivity.getTotals(U2), null, 'no data leaked into the global store');
  });
});