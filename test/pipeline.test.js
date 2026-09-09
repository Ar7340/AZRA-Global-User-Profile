import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  createTestStore, destroyTestStore, registerGuild, joinGuild, messageActivity,
  event, G, G2, U1, U2, ADMIN,
} from './helpers.js';
import { ingestEvent } from '../src/events/processor.js';
import { getStore } from '../src/db/index.js';
import { TABLE_NAMES } from '../src/db/json/schema.js';
import { EVENT_TYPES } from '../src/domain/catalog.js';
import { ValidationError, StorageError } from '../src/utils/errors.js';
import * as globalUsers from '../src/models/globalUsers.model.js';
import * as globalActivity from '../src/models/globalActivity.model.js';
import * as guildActivity from '../src/models/guildActivity.model.js';
import * as guildProfiles from '../src/models/guildProfiles.model.js';
import * as dataPermissions from '../src/models/dataPermissions.model.js';
import * as processedEvents from '../src/models/processedEvents.model.js';
import * as guildModeration from '../src/models/guildModeration.model.js';
import * as guildRoles from '../src/models/guildRoles.model.js';
import * as guildVerification from '../src/models/guildVerification.model.js';
import * as globalRestrictions from '../src/models/globalRestrictions.model.js';
import * as globalTimeline from '../src/models/globalTimeline.model.js';

beforeEach(async () => {
  await createTestStore('pipeline-test');
});

afterEach(async () => {
  await destroyTestStore();
});

test('guild registration seeds default permissions for its sharing level', async () => {
  await registerGuild(G, { level: 'FULL' });
  const guild = getStore().table(TABLE_NAMES.GUILDS).get(G);
  assert.equal(guild.is_participating, true);
  assert.equal(await dataPermissions.isCategoryAllowed(G, 'ACTIVITY'), true);
  assert.equal(await dataPermissions.isCategoryAllowed(G, 'MODERATION'), true);

  await registerGuild(G2, { level: 'STANDARD' });
  assert.equal(await dataPermissions.isCategoryAllowed(G2, 'ACTIVITY'), true);
  assert.equal(await dataPermissions.isCategoryAllowed(G2, 'MODERATION'), false);
});

test('changing the sharing level via profile-settings flips participation', async () => {
  // Start privacy-first at NONE — gate denies everything.
  await registerGuild(G, { level: 'NONE', name: 'Silent' });
  await joinGuild(G, U1);
  const before = await messageActivity(G, U1, 3);
  assert.equal(before.status, 'skipped');

  // Guild admin runs /profile-settings sharing:FULL → GUILD_UPDATE.
  const updated = await ingestEvent(event(EVENT_TYPES.GUILD_UPDATE, {
    dataSharingLevel: 'FULL',
    updatedByUserId: ADMIN,
  }, { guildId: G }));
  assert.equal(updated.status, 'processed');
  assert.equal(getStore().table(TABLE_NAMES.GUILDS).get(G).is_participating, true, 'participation derived from FULL');

  // Now the same event must land in the global store.
  const after = await messageActivity(G, U1, 3);
  assert.equal(after.status, 'processed');
  const totals = await globalActivity.getTotals(U1);
  assert.equal(totals.messages_seen, 3);
});

test('downgrading to NONE revokes participation immediately', async () => {
  await registerGuild(G, { level: 'FULL' });
  await joinGuild(G, U1);
  await messageActivity(G, U1, 2);

  await ingestEvent(event(EVENT_TYPES.GUILD_UPDATE, { dataSharingLevel: 'NONE' }, { guildId: G }));
  assert.equal(getStore().table(TABLE_NAMES.GUILDS).get(G).is_participating, false, 'NONE = not participating');

  const result = await messageActivity(G, U1, 1);
  assert.equal(result.status, 'skipped');
  assert.match(result.reason, /not participating/);
});

test('member join writes global user, guild profile and timeline', async () => {
  await registerGuild(G);
  await joinGuild(G, U1);

  const user = await globalUsers.getUser(U1);
  assert.ok(user, 'global user row created');
  assert.equal(user.username, 'tester');

  const profile = await guildProfiles.getGuildUser(G, U1);
  assert.equal(profile.membership_status, 'MEMBER');
  assert.ok(profile.joined_at);

  const timeline = await globalTimeline.getTimeline(U1, {});
  assert.equal(timeline.total, 1);
  assert.match(timeline.items[0].summary, /Joined/);
});

test('activity events increment global and guild counters with daily buckets', async () => {
  await registerGuild(G);
  await joinGuild(G, U1);
  await messageActivity(G, U1, 5, '2026-08-02T12:00:00.000Z');
  await messageActivity(G, U1, 7, '2026-08-03T12:00:00.000Z');

  const totals = await globalActivity.getTotals(U1);
  assert.equal(totals.messages_seen, 12);

  const daily = await globalActivity.getRecentDaily(U1, { limit: 7 });
  assert.equal(daily.length, 2);

  const guildTotals = await guildActivity.getTotals(G, U1);
  assert.equal(guildTotals.messages_seen, 12);
});

test('duplicate eventId is an idempotent no-op', async () => {
  await registerGuild(G);
  await joinGuild(G, U1);

  const e = event(EVENT_TYPES.ACTIVITY_MESSAGE, { amount: 5 }, { guildId: G, userId: U1 });
  const first = await ingestEvent(e);
  assert.equal(first.status, 'processed');

  const second = await ingestEvent(e); // same eventId → duplicate
  assert.equal(second.status, 'duplicate');

  const totals = await globalActivity.getTotals(U1);
  assert.equal(totals.messages_seen, 5, 'counter must not double-apply');

  const sourcesBefore = getStore().table(TABLE_NAMES.PROFILE_DATA_SOURCES).size;
  assert.equal(sourcesBefore, 3, 'register + join + activity provenance rows');
  await ingestEvent(e); // replay again — still a no-op
  assert.equal(getStore().table(TABLE_NAMES.PROFILE_DATA_SOURCES).size, sourcesBefore, 'no duplicate provenance');
});

test('events for non-participating guilds are skipped with a reason', async () => {
  await registerGuild(G, { level: 'NONE', name: 'Silent' });
  const result = await messageActivity(G, U1, 3);
  assert.equal(result.status, 'skipped');
  assert.match(result.reason, /not participating/);
  assert.equal(await processedEvents.countByStatus('SKIPPED'), 1);
  assert.equal(await globalActivity.getTotals(U1), null);
});

test('events for unregistered guilds are skipped', async () => {
  const result = await messageActivity('300000000000000099', U1, 1);
  assert.equal(result.status, 'skipped');
  assert.match(result.reason, /not registered/);
});

test('user opt-out (data_sharing_enabled=false) blocks subsequent events', async () => {
  await registerGuild(G);
  await joinGuild(G, U1);
  await guildProfiles.setDataSharingEnabled(G, U1, false, { updatedByUserId: ADMIN });

  const result = await messageActivity(G, U1, 1);
  assert.equal(result.status, 'skipped');
  assert.match(result.reason, /opted out/);
});

test('moderation events write guild-local records and MODERATOR_ONLY timeline', async () => {
  await registerGuild(G, { level: 'FULL' });
  await joinGuild(G, U2);

  const result = await ingestEvent(event(EVENT_TYPES.MODERATION_ACTION, {
    actionType: 'BAN', reason: 'raid behaviour', caseId: 'C-1', moderatorId: ADMIN,
  }, { guildId: G, userId: U2 }));

  assert.equal(result.status, 'processed');
  const action = await guildModeration.getBySourceEvent(result.eventId);
  assert.equal(action.action_type, 'BAN');
  assert.equal(action.reason, 'raid behaviour');

  const profile = await guildProfiles.getGuildUser(G, U2);
  assert.equal(profile.membership_status, 'BANNED');

  const timeline = await globalTimeline.getTimeline(U2, {});
  assert.equal(timeline.items[0].visibility, 'MODERATOR_ONLY');
  assert.ok(!JSON.stringify(timeline.items[0]).includes('raid behaviour'), 'reason must not leak into timeline');
});

test('role add/remove lifecycle', async () => {
  await registerGuild(G);
  await joinGuild(G, U1);
  const roleId = '400000000000000010';

  await ingestEvent(event(EVENT_TYPES.ROLE_ADDED, { roleId, roleName: 'Member' }, { guildId: G, userId: U1 }));
  assert.equal(await guildRoles.countActiveRoles(G, U1), 1);

  await ingestEvent(event(EVENT_TYPES.ROLE_REMOVED, { roleId }, { guildId: G, userId: U1 }));
  assert.equal(await guildRoles.countActiveRoles(G, U1), 0);

  await ingestEvent(event(EVENT_TYPES.ROLE_ADDED, { roleId, roleName: 'Member' }, { guildId: G, userId: U1 }));
  assert.equal(await guildRoles.countActiveRoles(G, U1), 1, 're-add reactivates history row');
  assert.equal(getStore().table(TABLE_NAMES.GUILD_USER_ROLES).size, 1);
});

test('verification events write guild state and enqueue global recalc', async () => {
  await registerGuild(G);
  await joinGuild(G, U1);
  await ingestEvent(event(EVENT_TYPES.VERIFICATION_COMPLETED, { method: 'CAPTCHA' }, { guildId: G, userId: U1 }));

  const verification = await guildVerification.getVerification(G, U1);
  assert.equal(verification.status, 'VERIFIED');

  const profile = await guildProfiles.getGuildUser(G, U1);
  assert.equal(profile.verification_status, 'VERIFIED');

  const pending = await getStore().table(TABLE_NAMES.AGGREGATION_QUEUE).count(
    (j) => j.job_type === 'RECALC_GLOBAL_VERIFICATION' && j.status === 'PENDING',
  );
  assert.equal(pending, 1);
});

test('global restrictions require the GLOBAL_ADMIN source', async () => {
  const denied = await ingestEvent(event(EVENT_TYPES.RESTRICTION_APPLIED, {
    restrictionType: 'GLOBAL_BAN',
  }, { userId: U1, guildId: G }));
  assert.equal(denied.status, 'skipped');
  assert.match(denied.reason, /GLOBAL_ADMIN/);

  const allowed = await ingestEvent(event(EVENT_TYPES.RESTRICTION_APPLIED, {
    restrictionType: 'GLOBAL_BAN', reason: 'platform abuse',
  }, { userId: U1, sourceType: 'GLOBAL_ADMIN' }));
  assert.equal(allowed.status, 'processed');
  assert.equal(await globalRestrictions.hasActiveRestriction(U1, 'GLOBAL_BAN'), true);
});

test('invalid events are rejected and recorded in the ledger', async () => {
  await assert.rejects(
    () => ingestEvent({ eventId: 'bad-1', type: 'NOPE', payload: {} }),
    ValidationError,
  );
  const ledger = await processedEvents.getEvent('bad-1');
  assert.equal(ledger.status, 'REJECTED');
});

test('handler failure is recorded as retryable with the error stored', async () => {
  await registerGuild(G);
  await joinGuild(G, U1);
  // expiresAt passes validation but the model's toIso() rejects it mid-handler.
  await assert.rejects(
    () => ingestEvent(event(EVENT_TYPES.MODERATION_ACTION, {
      actionType: 'TIMEOUT', expiresAt: 'not-a-date',
    }, { guildId: G, userId: U1 })),
    StorageError,
  );
  const failed = await processedEvents.listRecent({ status: 'RECEIVED', limit: 10 });
  const entry = failed.items.find((r) => r.event_type === 'MODERATION_ACTION');
  assert.ok(entry, 'failed event stays retryable under the attempt budget');
  assert.match(entry.last_error, /Invalid date/);
});

test('every processed event is traceable in profile_data_sources', async () => {
  await registerGuild(G);
  await joinGuild(G, U1);
  await messageActivity(G, U1, 2);

  const sources = [...getStore().table(TABLE_NAMES.PROFILE_DATA_SOURCES).values()];
  assert.equal(sources.length, 3); // register + join + activity
  for (const source of sources) {
    assert.equal(source.authorization_status, 'AUTHORIZED');
    assert.ok(source.visibility);
  }
  const activitySource = sources.find((s) => s.source_guild_id === G && s.visibility === 'GLOBAL');
  assert.ok(activitySource, 'activity writes carry GLOBAL visibility from the FULL level');
});

