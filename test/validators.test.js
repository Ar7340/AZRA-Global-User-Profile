import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isValidSnowflake, snowflakeToDate, optionalSnowflake } from '../src/utils/snowflake.js';
import { validateEvent } from '../src/events/validators.js';
import { EVENT_TYPES } from '../src/domain/catalog.js';
import { ValidationError } from '../src/utils/errors.js';

test('snowflake validation', () => {
  assert.equal(isValidSnowflake('175583438702837760'), true);
  assert.equal(isValidSnowflake('200000000000000101'), true);
  assert.equal(isValidSnowflake('123'), false); // too short
  assert.equal(isValidSnowflake('200000000000000101x'), false);
  assert.equal(isValidSnowflake(200000000000000101), false); // numbers rejected (precision)
  assert.equal(isValidSnowflake(null), false);
});

test('snowflake → date extraction', () => {
  const date = snowflakeToDate('175583438702837760');
  assert.equal(date.toISOString(), '2016-04-29T12:25:53.969Z');
  assert.equal(snowflakeToDate('nope'), null);
});

test('optionalSnowflake passes nulls and validates values', () => {
  assert.equal(optionalSnowflake(null, 'x'), null);
  assert.equal(optionalSnowflake('200000000000000101', 'x'), '200000000000000101');
  assert.throws(() => optionalSnowflake('12', 'x'), ValidationError);
});

const BASE = { type: EVENT_TYPES.USER_UPSERT, guildId: '300000000000000011', userId: '200000000000000101' };

test('valid event passes validation', () => {
  const event = validateEvent({ ...BASE, eventId: 'ev-1', payload: { username: 'alice' } });
  assert.equal(event.eventId, 'ev-1');
  assert.equal(event.sourceType, 'GUILD_EVENT');
  assert.ok(event.occurredAt);
});

test('missing eventId is auto-generated', () => {
  const event = validateEvent({ ...BASE });
  assert.ok(event.eventId.startsWith('auto:USER_UPSERT:'));
});

test('unknown event type is rejected', () => {
  assert.throws(() => validateEvent({ ...BASE, type: 'NOT_A_TYPE' }), ValidationError);
});

test('invalid snowflakes are rejected', () => {
  assert.throws(() => validateEvent({ ...BASE, userId: 'abc' }), ValidationError);
  assert.throws(() => validateEvent({ ...BASE, guildId: '42' }), ValidationError);
});

test('non-object events and payloads are rejected', () => {
  assert.throws(() => validateEvent(null), ValidationError);
  assert.throws(() => validateEvent('event'), ValidationError);
  assert.throws(() => validateEvent({ ...BASE, payload: [1, 2] }), ValidationError);
});

test('future timestamps beyond skew are rejected', () => {
  assert.throws(
    () => validateEvent({ ...BASE, occurredAt: '2126-01-01T00:00:00.000Z' }),
    /future/,
  );
});

test('malformed dates are rejected', () => {
  assert.throws(() => validateEvent({ ...BASE, occurredAt: 'not-a-date' }), ValidationError);
});

test('activity events stamp their activity kind', () => {
  const message = validateEvent({ ...BASE, type: EVENT_TYPES.ACTIVITY_MESSAGE, payload: { amount: 2 } });
  assert.equal(message.activityKind, 'message');
  const voice = validateEvent({ ...BASE, type: EVENT_TYPES.ACTIVITY_VOICE, payload: { amount: 5 } });
  assert.equal(voice.activityKind, 'voice');
});

test('moderation actions require a valid actionType', () => {
  assert.throws(
    () => validateEvent({ ...BASE, type: EVENT_TYPES.MODERATION_ACTION, payload: { actionType: 'NUKE' } }),
    /actionType/,
  );
  const ok = validateEvent({ ...BASE, type: EVENT_TYPES.MODERATION_ACTION, payload: { actionType: 'BAN' } });
  assert.equal(ok.payload.actionType, 'BAN');
});

test('badge keys are strictly shaped', () => {
  assert.throws(
    () => validateEvent({ type: EVENT_TYPES.BADGE_AWARDED, userId: BASE.userId, payload: { badgeKey: 'bad-key' } }),
    /badgeKey/,
  );
  const ok = validateEvent({ type: EVENT_TYPES.BADGE_AWARDED, userId: BASE.userId, payload: { badgeKey: 'BUG_HUNTER' } });
  assert.equal(ok.payload.badgeKey, 'BUG_HUNTER');
});

test('restriction events require userId and a known type', () => {
  assert.throws(
    () => validateEvent({ type: EVENT_TYPES.RESTRICTION_APPLIED, payload: { restrictionType: 'GLOBAL_BAN' } }),
    ValidationError,
  );
  assert.throws(
    () => validateEvent({ type: EVENT_TYPES.RESTRICTION_APPLIED, userId: BASE.userId, payload: { restrictionType: 'WEIRD' } }),
    /restrictionType/,
  );
});

test('guild events without guildId are rejected', () => {
  assert.throws(
    () => validateEvent({ type: EVENT_TYPES.MEMBER_JOINED, userId: BASE.userId }),
    /guildId/,
  );
});
