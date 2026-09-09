import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createTestStore, destroyTestStore, registerGuild, joinGuild, messageActivity, G, G2, U1 } from './helpers.js';
import { buildCoverage, getUserDataCoverage, coverageNote, humanizeMetric, describeMetric } from '../src/services/coverage.js';

beforeEach(async () => {
  await createTestStore('coverage-test');
});

afterEach(async () => {
  await destroyTestStore();
});

test('coverage completeness matrix', () => {
  assert.deepEqual(buildCoverage({ participating: 0, contributing: 0 }), {
    participatingCommunities: 0, serversContributing: 0, completeness: 'NO_COMMUNITIES',
  });
  assert.equal(buildCoverage({ participating: 5, contributing: 0 }).completeness, 'NONE');
  assert.equal(buildCoverage({ participating: 5, contributing: 2 }).completeness, 'PARTIAL');
  assert.equal(buildCoverage({ participating: 2, contributing: 2 }).completeness, 'FULL');
  assert.equal(buildCoverage({ participating: 3, contributing: 7 }).completeness, 'FULL');
});

test('THE DATA RULE: zero is never presented as a fact under partial coverage', () => {
  const coverage = buildCoverage({ participating: 20, contributing: 2 });

  // Zero + available communities → honest "no recorded" phrasing.
  assert.equal(
    humanizeMetric({ label: 'ban', count: 0 }),
    'No recorded bans in available AZRA data.',
  );

  // Non-zero + partial coverage → limited-data qualifier.
  assert.equal(
    describeMetric({ label: 'ban', count: 3, coverage }),
    '3 bans recorded. Limited data — 2 of 20 participating communities.',
  );

  // Non-zero + full coverage → plain statement.
  const full = buildCoverage({ participating: 2, contributing: 2 });
  assert.equal(describeMetric({ label: 'ban', count: 3, coverage: full }), '3 bans recorded.');
});

test('unknown data is phrased as unknown, never as zero', () => {
  assert.equal(
    humanizeMetric({ label: 'ban', count: null }),
    'Unknown — not enough AZRA data for bans.',
  );
});

test('coverage notes use the limited-data phrasing', () => {
  assert.equal(
    coverageNote(buildCoverage({ participating: 20, contributing: 2 })),
    'Limited data — 2 of 20 participating communities.',
  );
  assert.equal(
    coverageNote(buildCoverage({ participating: 2, contributing: 2 })),
    'Complete coverage — 2 participating communities.',
  );
  assert.match(coverageNote(buildCoverage({ participating: 3, contributing: 0 })), /No AZRA data yet/);
  assert.match(coverageNote(buildCoverage({ participating: 0, contributing: 0 })), /No participating communities yet/);
});

test('user coverage reflects real participating vs contributing guilds', async () => {
  // 2 participating guilds registered.
  await registerGuild(G, { level: 'FULL', name: 'A' });
  await registerGuild(G2, { level: 'STANDARD', name: 'B' });

  // No data at all yet → NONE.
  let coverage = await getUserDataCoverage(U1);
  assert.equal(coverage.completeness, 'NONE');
  assert.equal(coverage.participatingCommunities, 2);
  assert.equal(coverage.serversContributing, 0);

  // Activity in one guild → PARTIAL (1 of 2 communities contributing).
  await joinGuild(G, U1);
  await messageActivity(G, U1, 4);
  coverage = await getUserDataCoverage(U1);
  assert.equal(coverage.completeness, 'PARTIAL');
  assert.equal(coverage.serversContributing, 1);
  assert.equal(
    coverageNote(coverage),
    'Limited data — 1 of 2 participating communities.',
  );
});
