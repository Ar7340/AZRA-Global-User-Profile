/**
 * Seed script — basic test data for the AZRA Global User Profile foundation.
 *
 * Everything flows through ingestEvent() (the real pipeline), so the seed
 * also demonstrates: permission gating, idempotency, source tracking and
 * aggregation. One registered guild deliberately does NOT participate so the
 * coverage language ("Limited data — X of Y participating communities") has
 * a real case to render.
 *
 * Usage:
 *   node scripts/seed.js           # fresh seed (resets ./data)
 *   node scripts/seed.js --keep    # keep existing data (duplicates are skipped)
 */
import fs from 'node:fs';
import { env } from '../src/config/env.js';
import { initStore, closeStore, ingestEvent } from '../src/index.js';
import { runAggregationPass } from '../src/services/aggregationService.js';
import { getGlobalProfileSummary } from '../src/services/profileService.js';
import * as processedEvents from '../src/models/processedEvents.model.js';
import { EVENT_TYPES } from '../src/domain/catalog.js';

const GUILD_A = '300000000000000001'; // Aether Nexus — FULL sharing
const GUILD_B = '300000000000000002'; // Nova Collective — STANDARD sharing
const GUILD_C = '300000000000000003'; // Whisper Hall — NONE (not participating)

const ADMIN = '200000000000000001';
const ALICE = '200000000000000002';
const BOB = '200000000000000003';
const CARA = '200000000000000004';
const DAVE = '200000000000000005';
const GHOST = '200000000000000006';

const T0 = '2026-08-01T12:00:00.000Z';
const T1 = '2026-08-02T13:30:00.000Z';
const T2 = '2026-08-05T18:00:00.000Z';
const T3 = '2026-08-10T09:15:00.000Z';

const outcomes = [];
let seq = 0;

function ev(type, payload, { at = T0, guildId = null, userId = null, sourceType } = {}) {
  return {
    eventId: `seed-${String(++seq).padStart(4, '0')}`,
    type,
    guildId,
    userId,
    sourceType,
    occurredAt: at,
    payload,
  };
}

async function push(event) {
  const result = await ingestEvent(event);
  outcomes.push({ eventId: event.eventId, type: event.type, status: result.status, reason: result.reason });
  return result;
}

async function seedGuildsAndMembers() {
  await push(ev(EVENT_TYPES.GUILD_REGISTER, {
    name: 'Aether Nexus', memberCount: 4200, dataSharingLevel: 'FULL', registeredByUserId: ADMIN,
  }, { guildId: GUILD_A }));
  await push(ev(EVENT_TYPES.GUILD_REGISTER, {
    name: 'Nova Collective', memberCount: 1500, dataSharingLevel: 'STANDARD', registeredByUserId: ADMIN,
  }, { guildId: GUILD_B }));
  await push(ev(EVENT_TYPES.GUILD_REGISTER, {
    name: 'Whisper Hall', memberCount: 300, dataSharingLevel: 'NONE', registeredByUserId: ADMIN,
  }, { guildId: GUILD_C }));

  const rosters = [
    [GUILD_A, [ADMIN, ALICE, BOB, CARA, DAVE, GHOST]],
    [GUILD_B, [ALICE, BOB, DAVE]],
    [GUILD_C, [GHOST]],
  ];
  for (const [guildId, users] of rosters) {
    for (const userId of users) {
      await push(ev(EVENT_TYPES.USER_UPSERT, {
        username: `user_${userId.slice(-3)}`,
        globalName: userId === ALICE ? 'Alice' : userId === BOB ? 'Bob' : null,
        accountCreatedAt: '2019-03-14T10:00:00.000Z',
      }, { guildId, userId }));
      await push(ev(EVENT_TYPES.MEMBER_JOINED, {
        username: `user_${userId.slice(-3)}`, joinedAt: T0,
      }, { guildId, userId }));
    }
  }
}

async function seedActivityAndHistory() {
  // ── Activity (drives contributing-guild coverage) ───────────────────────
  for (let day = 0; day < 12; day += 1) {
    const at = new Date(Date.parse(T1) + day * 86_400_000).toISOString();
    for (const userId of [ALICE, BOB]) {
      await push(ev(EVENT_TYPES.ACTIVITY_MESSAGE, { amount: 5 + day }, { guildId: GUILD_A, userId, at }));
    }
    await push(ev(EVENT_TYPES.ACTIVITY_MESSAGE, { amount: 3 }, { guildId: GUILD_B, userId: ALICE, at }));
    await push(ev(EVENT_TYPES.ACTIVITY_VOICE, { amount: 25 }, { guildId: GUILD_A, userId: CARA, at: T2 }));
    await push(ev(EVENT_TYPES.ACTIVITY_REACTION, { amount: 8 }, { guildId: GUILD_B, userId: DAVE, at: T3 }));
    // Whisper Hall events — must be SKIPPED (not participating).
    await push(ev(EVENT_TYPES.ACTIVITY_MESSAGE, { amount: 9 }, { guildId: GUILD_C, userId: GHOST, at }));
  }

  // ── Verification ────────────────────────────────────────────────────────
  await push(ev(EVENT_TYPES.VERIFICATION_COMPLETED, { method: 'RULES_GATE', verifiedByUserId: ADMIN }, { guildId: GUILD_A, userId: ALICE, at: T1 }));
  await push(ev(EVENT_TYPES.VERIFICATION_COMPLETED, { method: 'CAPTCHA' }, { guildId: GUILD_B, userId: ALICE, at: T2 }));
  await push(ev(EVENT_TYPES.VERIFICATION_COMPLETED, { method: 'ROLE' }, { guildId: GUILD_A, userId: BOB, at: T2 }));

  // ── Roles ───────────────────────────────────────────────────────────────
  await push(ev(EVENT_TYPES.ROLE_ADDED, { roleId: '400000000000000001', roleName: 'Moderator', rolePosition: 50, grantedByUserId: ADMIN }, { guildId: GUILD_A, userId: CARA, at: T1 }));
  await push(ev(EVENT_TYPES.ROLE_ADDED, { roleId: '400000000000000002', roleName: 'Member', rolePosition: 10 }, { guildId: GUILD_A, userId: ALICE, at: T1 }));

  // ── Moderation (guild A shares MODERATION; guild B does not) ────────────
  await push(ev(EVENT_TYPES.MODERATION_ACTION, {
    actionType: 'WARN', reason: 'Spamming #general', caseId: 'A-1042', moderatorId: ADMIN,
  }, { guildId: GUILD_A, userId: DAVE, at: T3 }));
  await push(ev(EVENT_TYPES.MODERATION_ACTION, {
    actionType: 'BAN', reason: 'Raid behaviour', caseId: 'A-1043', moderatorId: ADMIN,
  }, { guildId: GUILD_A, userId: GHOST, at: T3 }));
  await push(ev(EVENT_TYPES.MODERATION_ACTION, {
    actionType: 'WARN', reason: 'Guild-B internal — must be gated', moderatorId: ADMIN,
  }, { guildId: GUILD_B, userId: BOB, at: T3 }));

  // ── Recognition ─────────────────────────────────────────────────────────
  await push(ev(EVENT_TYPES.BADGE_AWARDED, { badgeKey: 'BUG_HUNTER', awardedByUserId: ADMIN }, { guildId: GUILD_A, userId: ALICE, at: T2 }));
  await push(ev(EVENT_TYPES.ACHIEVEMENT_UNLOCKED, { achievementKey: 'CONVERSATION_STARTER', tier: 2 }, { guildId: GUILD_A, userId: ALICE, at: T2 }));
  await push(ev(EVENT_TYPES.REPUTATION_SIGNAL, { direction: 'POSITIVE', amount: 3 }, { guildId: GUILD_A, userId: ALICE, at: T3 }));

  // ── Global restriction (AZRA platform admin) ────────────────────────────
  await push(ev(EVENT_TYPES.RESTRICTION_APPLIED, {
    restrictionType: 'VERIFICATION_HOLD',
    reason: 'Suspicious cross-guild raid pattern',
    issuedByUserId: ADMIN,
  }, { userId: GHOST, at: T3, sourceType: 'GLOBAL_ADMIN' }));
}

async function main() {
  const keep = process.argv.includes('--keep');
  if (!keep && fs.existsSync(env.dataDir)) {
    fs.rmSync(env.dataDir, { recursive: true, force: true });
    console.log(`· reset data directory ${env.dataDir}`);
  }

  await initStore({ dataDir: env.dataDir });
  console.log(`· store ready (driver=${env.driver}, dir=${env.dataDir})\n`);

  await seedGuildsAndMembers();
  await seedActivityAndHistory();

  // ── Drain aggregation queue ─────────────────────────────────────────────
  let totalOk = 0;
  for (;;) {
    const pass = await runAggregationPass();
    totalOk += pass.ok;
    if (pass.claimed === 0) break;
  }
  console.log(`· aggregation drained: ${totalOk} jobs completed\n`);

  // ── Ledger summary ──────────────────────────────────────────────────────
  const statuses = {};
  for (const o of outcomes) statuses[o.status] = (statuses[o.status] ?? 0) + 1;
  console.log('· ingestion ledger:', JSON.stringify(statuses));
  const skippedSample = outcomes.find((o) => o.status === 'skipped');
  if (skippedSample) {
    console.log(`· skipped example: ${skippedSample.type} → "${skippedSample.reason}"`);
  }
  console.log(`· ledger: processed=${await processedEvents.countByStatus('PROCESSED')}, rejected=${await processedEvents.countByStatus('REJECTED')}\n`);

  // ── Sample summaries (never-zero language in action) ────────────────────
  for (const [userId, scope] of [[ALICE, 'PUBLIC'], [DAVE, 'MODERATOR'], [GHOST, 'MODERATOR']]) {
    let summary;
    try {
      summary = await getGlobalProfileSummary(userId, { viewerScope: scope, useCache: false });
    } catch (err) {
      console.log(`GLOBAL PROFILE — ${userId}: unavailable (${err.message})`);
      continue;
    }
    console.log('='.repeat(72));
    console.log(`GLOBAL PROFILE — ${summary.user.username ?? userId} (viewer: ${scope})`);
    console.log(`  coverage: ${summary.coverage.completeness} — ${summary.coverage.note}`);
    if (summary.activity?.hasData) {
      console.log(`  activity: ${summary.activity.lines.messages}`);
      console.log(`  contributing guilds: ${summary.activity.contributingGuilds}`);
    } else {
      console.log(`  activity: ${summary.activity?.note}`);
    }
    if (summary.verification) {
      console.log(`  verification: ${summary.verification.status} (${summary.verification.highestLevel}, ${summary.verification.confirmingGuilds} guilds)`);
    }
    console.log(`  badges: ${summary.badges?.count ?? 0}`);
    console.log(`  reputation: ${summary.reputation.level}`);
    if (summary.moderation) {
      console.log(`  moderation [${scope} view]: ${summary.moderation.lines.bans} | ${summary.moderation.lines.warns}`);
    }
    if (summary.restrictions?.length) {
      console.log(`  restrictions: ${summary.restrictions.map((r) => `${r.type} (${r.status})`).join(', ')}`);
    }
    console.log(`  timeline (showing ${Math.min(4, summary.timeline.length)} of ${summary.timeline.length}):`);
    for (const entry of summary.timeline.slice(0, 4)) {
      console.log(`    [${entry.visibility}] ${entry.occurredAt.slice(0, 10)} — ${entry.summary}`);
    }
  }
  console.log('='.repeat(72));
  console.log('\nSeed complete. Next: run `npm test`, or import src/index.js in the bot.');
}

main()
  .then(() => closeStore())
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error('Seed failed:', err);
    await closeStore().catch(() => {});
    process.exit(1);
  });

process.on('SIGINT', async () => {
  await closeStore().catch(() => {});
  process.exit(130);
});
