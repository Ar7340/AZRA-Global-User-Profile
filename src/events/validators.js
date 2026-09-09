import { randomUUID } from 'node:crypto';
import { env } from '../config/env.js';
import { ValidationError } from '../utils/errors.js';
import { nowIso, toIso } from '../utils/dates.js';
import { assertSnowflake, optionalSnowflake } from '../utils/snowflake.js';
import {
  EVENT_TYPES,
  SOURCE_TYPES,
  MODERATION_ACTION_TYPES,
  RESTRICTION_TYPES,
  VERIFICATION_METHODS,
  GUILD_DATA_SHARING_LEVELS,
} from './eventTypes.js';

const BADGE_KEY_RE = /^[A-Z][A-Z0-9_]{1,63}$/;

function requireGuild(event) {
  if (!event.guildId) throw new ValidationError(`Event ${event.type} requires guildId`);
}

function requireUser(event) {
  if (!event.userId) throw new ValidationError(`Event ${event.type} requires userId`);
}

function requireEnum(payload, field, allowed) {
  const value = payload[field];
  if (value == null) throw new ValidationError(`payload.${field} is required`);
  if (!allowed.includes(value)) {
    throw new ValidationError(
      `payload.${field} "${value}" is invalid (expected one of: ${allowed.join(', ')})`,
    );
  }
}

function optionalEnum(payload, field, allowed) {
  const value = payload[field];
  if (value == null) return;
  if (!allowed.includes(value)) {
    throw new ValidationError(
      `payload.${field} "${value}" is invalid (expected one of: ${allowed.join(', ')})`,
    );
  }
}

function optionalBoundedString(payload, field, max) {
  const value = payload[field];
  if (value == null) return;
  if (typeof value !== 'string' || value.length === 0 || value.length > max) {
    throw new ValidationError(
      `payload.${field} must be a non-empty string of at most ${max} characters`,
    );
  }
}

const PAYLOAD_VALIDATORS = {
  [EVENT_TYPES.GUILD_REGISTER](event) {
    requireGuild(event);
    optionalBoundedString(event.payload, 'name', 100);
    optionalEnum(event.payload, 'dataSharingLevel', GUILD_DATA_SHARING_LEVELS);
  },
  [EVENT_TYPES.GUILD_UPDATE](event) {
    requireGuild(event);
    optionalBoundedString(event.payload, 'name', 100);
    optionalEnum(event.payload, 'dataSharingLevel', GUILD_DATA_SHARING_LEVELS);
    optionalEnum(event.payload, 'status', ['ACTIVE', 'PAUSED', 'REMOVED']);
  },
  [EVENT_TYPES.USER_UPSERT](event) {
    requireGuild(event);
    requireUser(event);
    optionalBoundedString(event.payload, 'username', 32);
    optionalBoundedString(event.payload, 'globalName', 32);
  },
  [EVENT_TYPES.MEMBER_JOINED](event) {
    requireGuild(event);
    requireUser(event);
    optionalBoundedString(event.payload, 'username', 32);
  },
  [EVENT_TYPES.MEMBER_LEFT](event) {
    requireGuild(event);
    requireUser(event);
  },
  [EVENT_TYPES.ACTIVITY_MESSAGE](event) {
    requireGuild(event);
    requireUser(event);
    event.activityKind = 'message';
  },
  [EVENT_TYPES.ACTIVITY_VOICE](event) {
    requireGuild(event);
    requireUser(event);
    event.activityKind = 'voice';
  },
  [EVENT_TYPES.ACTIVITY_REACTION](event) {
    requireGuild(event);
    requireUser(event);
    event.activityKind = 'reaction';
  },
  [EVENT_TYPES.ACTIVITY_COMMAND](event) {
    requireGuild(event);
    requireUser(event);
    event.activityKind = 'command';
  },
  [EVENT_TYPES.ROLE_ADDED](event) {
    requireGuild(event);
    requireUser(event);
    assertSnowflake(String(event.payload.roleId ?? ''), 'payload.roleId');
  },
  [EVENT_TYPES.ROLE_REMOVED](event) {
    requireGuild(event);
    requireUser(event);
    assertSnowflake(String(event.payload.roleId ?? ''), 'payload.roleId');
  },
  [EVENT_TYPES.VERIFICATION_COMPLETED](event) {
    requireGuild(event);
    requireUser(event);
    optionalEnum(event.payload, 'method', VERIFICATION_METHODS);
  },
  [EVENT_TYPES.VERIFICATION_FAILED](event) {
    requireGuild(event);
    requireUser(event);
    optionalEnum(event.payload, 'method', VERIFICATION_METHODS);
  },
  [EVENT_TYPES.MODERATION_ACTION](event) {
    requireGuild(event);
    requireUser(event);
    requireEnum(event.payload, 'actionType', MODERATION_ACTION_TYPES);
    optionalBoundedString(event.payload, 'reason', 500);
    optionalBoundedString(event.payload, 'caseId', 64);
  },
  [EVENT_TYPES.BADGE_AWARDED](event) {
    requireUser(event);
    if (!BADGE_KEY_RE.test(String(event.payload.badgeKey ?? ''))) {
      throw new ValidationError('payload.badgeKey must match /^[A-Z][A-Z0-9_]{1,63}$/');
    }
  },
  [EVENT_TYPES.BADGE_REVOKED](event) {
    requireUser(event);
    if (!BADGE_KEY_RE.test(String(event.payload.badgeKey ?? ''))) {
      throw new ValidationError('payload.badgeKey must match /^[A-Z][A-Z0-9_]{1,63}$/');
    }
  },
  [EVENT_TYPES.ACHIEVEMENT_UNLOCKED](event) {
    requireUser(event);
    if (!BADGE_KEY_RE.test(String(event.payload.achievementKey ?? ''))) {
      throw new ValidationError('payload.achievementKey must match /^[A-Z][A-Z0-9_]{1,63}$/');
    }
    const tier = event.payload.tier;
    if (tier != null && (!Number.isInteger(tier) || tier < 1 || tier > 10)) {
      throw new ValidationError('payload.tier must be an integer between 1 and 10');
    }
  },
  [EVENT_TYPES.REPUTATION_SIGNAL](event) {
    requireUser(event);
    requireEnum(event.payload, 'direction', ['POSITIVE', 'NEGATIVE']);
  },
  [EVENT_TYPES.RESTRICTION_APPLIED](event) {
    requireUser(event);
    requireEnum(event.payload, 'restrictionType', RESTRICTION_TYPES);
  },
  [EVENT_TYPES.RESTRICTION_LIFTED](event) {
    requireUser(event);
    requireEnum(event.payload, 'restrictionType', RESTRICTION_TYPES);
  },
};

/**
 * Validates and normalizes a raw Discord-side event into the canonical
 * processor shape. Throws ValidationError with details on any violation.
 */
export function validateEvent(raw) {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ValidationError('Event must be a non-null object');
  }

  const type = raw.type;
  if (typeof type !== 'string' || !Object.values(EVENT_TYPES).includes(type)) {
    throw new ValidationError(`Unknown event type "${String(type)}"`);
  }

  let eventId = raw.eventId;
  if (eventId == null) {
    eventId = `auto:${type}:${randomUUID()}`;
  } else if (typeof eventId !== 'string' || eventId.length === 0 || eventId.length > 128) {
    throw new ValidationError('eventId must be a non-empty string of at most 128 characters');
  }

  if (raw.payload != null && (typeof raw.payload !== 'object' || Array.isArray(raw.payload))) {
    throw new ValidationError('payload must be an object when provided');
  }

  const guildId = optionalSnowflake(raw.guildId, 'guildId');
  const userId = optionalSnowflake(raw.userId ?? raw.payload?.userId, 'userId');
  const occurredAt = raw.occurredAt != null ? toIso(raw.occurredAt) : nowIso();
  if (Date.parse(occurredAt) > Date.now() + env.events.maxFutureSkewMs) {
    throw new ValidationError('occurredAt is in the future beyond the allowed clock skew');
  }

  const sourceType = raw.sourceType ?? (guildId ? 'GUILD_EVENT' : 'AZRA_SYSTEM');
  if (!SOURCE_TYPES.includes(sourceType)) {
    throw new ValidationError(`Invalid sourceType "${sourceType}"`);
  }

  const event = {
    eventId,
    type,
    guildId,
    userId,
    occurredAt,
    sourceType,
    sourceRef: raw.sourceRef != null ? String(raw.sourceRef).slice(0, 190) : null,
    payload: raw.payload ?? {},
    activityKind: null,
  };

  const validator = PAYLOAD_VALIDATORS[type];
  if (validator) validator(event);
  return event;
}
