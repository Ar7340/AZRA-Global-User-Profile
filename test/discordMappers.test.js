import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  deterministicEventId,
  diffRoles,
  viewerScopeFromPermissions,
  identityPayloadFromUser,
  guildPayloadFromGuild,
  assertSharingLevel,
  timeoutChanged,
  sharingLevelDescription,
} from '../bot/mappers.js';
import { VoiceTracker } from '../bot/voiceTracker.js';
import { COMMANDS } from '../bot/commands/index.js';
import { ValidationError } from '../src/utils/errors.js';

describe('deterministicEventId', () => {
  test('joins parts stably and null-safely', () => {
    assert.equal(deterministicEventId('djs', 'msg', '1234'), 'djs:msg:1234');
    assert.equal(deterministicEventId('a', null, 'b'), 'a::b');
    assert.equal(deterministicEventId(), '');
    assert.equal(deterministicEventId('djs', 'msg', '1234'), deterministicEventId('djs', 'msg', '1234'));
  });
});

describe('viewerScopeFromPermissions', () => {
  test('maps the permission matrix', () => {
    assert.equal(viewerScopeFromPermissions({ administrator: true }), 'ADMIN');
    assert.equal(viewerScopeFromPermissions({ moderateMembers: true }), 'MODERATOR');
    assert.equal(viewerScopeFromPermissions({ manageMessages: true }), 'MODERATOR');
    assert.equal(viewerScopeFromPermissions({ manageGuild: true }), 'MODERATOR');
    assert.equal(viewerScopeFromPermissions({}), 'PUBLIC');
    assert.equal(viewerScopeFromPermissions(), 'PUBLIC');
  });

  test('administrator outranks moderator', () => {
    assert.equal(viewerScopeFromPermissions({ administrator: true, moderateMembers: true }), 'ADMIN');
  });
});

describe('identityPayloadFromUser', () => {
  test('maps a discord.js-like user', () => {
    const payload = identityPayloadFromUser({
      id: '200000000000000101',
      username: 'alice',
      globalName: 'Alice',
      displayName: 'Alice display',
      avatar: 'hash123',
      bot: false,
      createdAt: '2020-01-01T00:00:00.000Z',
    });
    assert.equal(payload.username, 'alice');
    assert.equal(payload.globalName, 'Alice');
    assert.equal(payload.avatarHash, 'hash123');
    assert.equal(payload.isBot, false);
  });

  test('falls back to displayName and tolerates missing fields', () => {
    const payload = identityPayloadFromUser({ id: 42, displayName: 'Display', bot: true });
    assert.equal(payload.globalName, 'Display');
    assert.equal(payload.isBot, true);
    assert.equal(payload.username, null);
  });
});

describe('guildPayloadFromGuild', () => {
  test('maps guild basics', () => {
    const payload = guildPayloadFromGuild({ id: '300000000000000001', name: 'Aether', memberCount: 42, icon: 'abc' });
    assert.equal(payload.name, 'Aether');
    assert.equal(payload.memberCount, 42);
    assert.equal(payload.iconHash, 'abc');
  });
});

describe('diffRoles', () => {
  test('detects additions and removals', () => {
    const oldRoles = [{ id: '1', name: 'A', position: 1 }, { id: '2', name: 'B', position: 2 }];
    const newRoles = [{ id: '2', name: 'B', position: 2 }, { id: '3', name: 'C', position: 3 }];
    const { added, removed } = diffRoles(oldRoles, newRoles);
    assert.deepEqual(added.map((r) => r.id), ['3']);
    assert.deepEqual(removed.map((r) => r.id), ['1']);
  });

  test('empty diff when unchanged', () => {
    const roles = [{ id: '1', name: 'A', position: 1 }];
    const { added, removed } = diffRoles(roles, [...roles]);
    assert.equal(added.length, 0);
    assert.equal(removed.length, 0);
  });
});

describe('timeoutChanged', () => {
  test('fires only for fresh timeouts', () => {
    const future = Date.now() + 600_000;
    assert.equal(timeoutChanged({}, { communicationDisabledUntilTimestamp: future }), true);
    assert.equal(timeoutChanged(
      { communicationDisabledUntilTimestamp: future },
      { communicationDisabledUntilTimestamp: future },
    ), false);
    assert.equal(timeoutChanged({}, {}), false);
    assert.equal(timeoutChanged(undefined, {}), false);
  });
});

describe('assertSharingLevel', () => {
  test('accepts valid levels and rejects others', () => {
    for (const level of ['NONE', 'MINIMAL', 'STANDARD', 'FULL']) {
      assert.equal(assertSharingLevel(level), level);
    }
    assert.throws(() => assertSharingLevel('EVERYTHING'), ValidationError);
  });

  test('every level has a human description', () => {
    for (const level of ['NONE', 'MINIMAL', 'STANDARD', 'FULL']) {
      assert.ok(sharingLevelDescription(level).length > 10);
    }
  });
});

describe('VoiceTracker', () => {
  test('accumulates minutes between join and leave', () => {
    const tracker = new VoiceTracker();
    const t0 = Date.parse('2026-08-01T12:00:00.000Z');
    tracker.join('g1', 'u1', t0);
    const session = tracker.leave('g1', 'u1', t0 + 5 * 60_000 + 30_000);
    assert.equal(session.minutes, 6); // rounds up to nearest minute
    assert.equal(session.joinedAt, '2026-08-01T12:00:00.000Z');
  });

  test('minimum one minute; unknown-leave returns null', () => {
    const tracker = new VoiceTracker();
    tracker.join('g1', 'u1', Date.parse('2026-08-01T12:00:00.000Z'));
    assert.equal(tracker.leave('g1', 'u1', Date.parse('2026-08-01T12:00:10.000Z')).minutes, 1);
    assert.equal(tracker.leave('g1', 'u1'), null, 'second leave without join');
    assert.equal(tracker.leave('g2', 'u2'), null, 'never joined');
  });

  test('tracks users independently', () => {
    const tracker = new VoiceTracker();
    tracker.join('g1', 'u1');
    tracker.join('g1', 'u2');
    tracker.join('g2', 'u1');
    assert.equal(tracker.size(), 3);
    tracker.leave('g1', 'u1');
    assert.equal(tracker.size(), 2);
  });
});

describe('slash command registry', () => {
  test('all commands export data + execute with unique names', () => {
    const names = COMMANDS.map((c) => c.data.name);
    assert.equal(new Set(names).size, names.length);
    for (const command of COMMANDS) {
      assert.equal(typeof command.execute, 'function');
      assert.ok(command.data);
    }
    assert.deepEqual(
      [...new Set(names)].sort(),
      ['generate-data', 'profile'],
    );
  });
});

