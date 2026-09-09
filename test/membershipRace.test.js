import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createTestStore, destroyTestStore, registerGuild, joinGuild, messageActivity,
  event, G, G2, U1, U2, U3, ADMIN,
} from './helpers.js';
import { ingestEvent } from '../src/events/processor.js';
import { EVENT_TYPES } from '../src/domain/catalog.js';
import * as guildProfiles from '../src/models/guildProfiles.model.js';
import * as guildModeration from '../src/models/guildModeration.model.js';

test('bans survive the ban+leave event race (BANNED never regresses to LEFT)', async () => {
  await createTestStore('race-test');
  try {
    await registerGuild(G, { level: 'FULL' });
    await joinGuild(G, U1);
    await messageActivity(G, U1, 1);

    // Discord fires GuildBanAdd and GuildMemberRemove for the same member;
    // the leave event can arrive after the ban.
    await ingestEvent(event(EVENT_TYPES.MODERATION_ACTION, {
      actionType: 'BAN', reason: 'raid', moderatorId: ADMIN,
    }, { guildId: G, userId: U1 }));
    await guildProfiles.setMembershipStatus({ guildId: G, userId: U1, status: 'LEFT', at: '2026-08-02T12:00:00.000Z' });

    const profile = await guildProfiles.getGuildUser(G, U1);
    assert.equal(profile.membership_status, 'BANNED', 'leave event must not clear a ban');
    assert.equal(
      profile.left_at,
      '2026-08-01T12:00:00.000Z',
      'blocked LEFT event must not overwrite left_at with the leave time (2026-08-02)',
    );
  } finally {
    await destroyTestStore();
  }
});

test('unban lifts the ban; rejoin reactivates membership', async () => {
  await createTestStore('unban-test');
  try {
    await registerGuild(G, { level: 'FULL' });
    await joinGuild(G, U2);
    await ingestEvent(event(EVENT_TYPES.MODERATION_ACTION, { actionType: 'BAN' }, { guildId: G, userId: U2 }));
    await ingestEvent(event(EVENT_TYPES.MODERATION_ACTION, { actionType: 'UNBAN' }, { guildId: G, userId: U2 }));
    await ingestEvent(event(EVENT_TYPES.MEMBER_JOINED, { username: 'u2' }, { guildId: G, userId: U2, at: '2026-08-03T12:00:00.000Z' }));

    const profile = await guildProfiles.getGuildUser(G, U2);
    assert.equal(profile.membership_status, 'MEMBER');
    const actions = await guildModeration.countActionsByType(G, U2);
    assert.equal(actions.BAN, 1);
    assert.equal(actions.UNBAN, 1);
  } finally {
    await destroyTestStore();
  }
});
