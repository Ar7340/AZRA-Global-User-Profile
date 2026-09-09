/**
 * Single source of truth for AZRA domain constants.
 * Consumed by validators, the permission gate, handlers and services.
 */

export const DATA_CATEGORIES = [
  'IDENTITY',
  'ACTIVITY',
  'ROLES',
  'MODERATION',
  'VERIFICATION',
  'REPUTATION',
  'TIMELINE',
];

export const VISIBILITY = {
  PRIVATE: 'PRIVATE',
  MODERATOR_ONLY: 'MODERATOR_ONLY',
  GUILD: 'GUILD',
  GLOBAL: 'GLOBAL',
};

export const VISIBILITY_RANK = {
  PRIVATE: 0,
  MODERATOR_ONLY: 1,
  GUILD: 2,
  GLOBAL: 3,
};

export const EVENT_TYPES = {
  GUILD_REGISTER: 'GUILD_REGISTER',
  GUILD_UPDATE: 'GUILD_UPDATE',
  USER_UPSERT: 'USER_UPSERT',
  MEMBER_JOINED: 'MEMBER_JOINED',
  MEMBER_LEFT: 'MEMBER_LEFT',
  ACTIVITY_MESSAGE: 'ACTIVITY_MESSAGE',
  ACTIVITY_VOICE: 'ACTIVITY_VOICE',
  ACTIVITY_REACTION: 'ACTIVITY_REACTION',
  ACTIVITY_COMMAND: 'ACTIVITY_COMMAND',
  ROLE_ADDED: 'ROLE_ADDED',
  ROLE_REMOVED: 'ROLE_REMOVED',
  VERIFICATION_COMPLETED: 'VERIFICATION_COMPLETED',
  VERIFICATION_FAILED: 'VERIFICATION_FAILED',
  MODERATION_ACTION: 'MODERATION_ACTION',
  BADGE_AWARDED: 'BADGE_AWARDED',
  BADGE_REVOKED: 'BADGE_REVOKED',
  ACHIEVEMENT_UNLOCKED: 'ACHIEVEMENT_UNLOCKED',
  REPUTATION_SIGNAL: 'REPUTATION_SIGNAL',
  RESTRICTION_APPLIED: 'RESTRICTION_APPLIED',
  RESTRICTION_LIFTED: 'RESTRICTION_LIFTED',
};

/** Which data category each event type belongs to (null = special path). */
export const EVENT_CATEGORY = {
  [EVENT_TYPES.GUILD_REGISTER]: null, // system path — creates the guild itself
  [EVENT_TYPES.GUILD_UPDATE]: null, // system path
  [EVENT_TYPES.USER_UPSERT]: 'IDENTITY',
  [EVENT_TYPES.MEMBER_JOINED]: 'IDENTITY',
  [EVENT_TYPES.MEMBER_LEFT]: 'IDENTITY',
  [EVENT_TYPES.ACTIVITY_MESSAGE]: 'ACTIVITY',
  [EVENT_TYPES.ACTIVITY_VOICE]: 'ACTIVITY',
  [EVENT_TYPES.ACTIVITY_REACTION]: 'ACTIVITY',
  [EVENT_TYPES.ACTIVITY_COMMAND]: 'ACTIVITY',
  [EVENT_TYPES.ROLE_ADDED]: 'ROLES',
  [EVENT_TYPES.ROLE_REMOVED]: 'ROLES',
  [EVENT_TYPES.VERIFICATION_COMPLETED]: 'VERIFICATION',
  [EVENT_TYPES.VERIFICATION_FAILED]: 'VERIFICATION',
  [EVENT_TYPES.MODERATION_ACTION]: 'MODERATION',
  [EVENT_TYPES.BADGE_AWARDED]: 'REPUTATION',
  [EVENT_TYPES.BADGE_REVOKED]: 'REPUTATION',
  [EVENT_TYPES.ACHIEVEMENT_UNLOCKED]: 'REPUTATION',
  [EVENT_TYPES.REPUTATION_SIGNAL]: 'REPUTATION',
  [EVENT_TYPES.RESTRICTION_APPLIED]: null, // GLOBAL_ADMIN path only
  [EVENT_TYPES.RESTRICTION_LIFTED]: null, // GLOBAL_ADMIN path only
};

/** Most public visibility a category may receive when a guild allows it. */
export const CATEGORY_DEFAULT_VISIBILITY = {
  IDENTITY: VISIBILITY.GLOBAL,
  ACTIVITY: VISIBILITY.GLOBAL,
  ROLES: VISIBILITY.GUILD,
  MODERATION: VISIBILITY.MODERATOR_ONLY,
  VERIFICATION: VISIBILITY.GLOBAL,
  REPUTATION: VISIBILITY.GLOBAL,
  TIMELINE: VISIBILITY.GUILD,
};

export const SOURCE_TYPES = [
  'GUILD_EVENT',
  'GUILD_ADMIN',
  'GLOBAL_ADMIN',
  'AZRA_SYSTEM',
  'USER_SELF_REPORT',
];

export const AUTHORIZATION_STATUSES = ['AUTHORIZED', 'PENDING', 'DENIED', 'REVOKED'];

export const ACTIVITY_COUNTER_FIELD = {
  message: 'messages_seen',
  reaction: 'reactions_added',
  voice: 'voice_minutes',
  command: 'commands_used',
};

export const ACTIVITY_KINDS = Object.keys(ACTIVITY_COUNTER_FIELD);

export const MODERATION_ACTION_TYPES = ['WARN', 'TIMEOUT', 'KICK', 'BAN', 'UNBAN', 'MUTE', 'NOTE'];

export const RESTRICTION_TYPES = ['GLOBAL_BAN', 'GLOBAL_MUTE', 'VERIFICATION_HOLD', 'SANCTION'];

export const MEMBERSHIP_STATUSES = ['MEMBER', 'GUEST', 'PENDING', 'LEFT', 'BANNED'];

export const VERIFICATION_METHODS = ['RULES_GATE', 'ROLE', 'CAPTCHA', 'MANUAL', 'EXTERNAL'];

export const VERIFICATION_STATUSES = ['PENDING', 'VERIFIED', 'FAILED', 'EXPIRED'];

export const GUILD_DATA_SHARING_LEVELS = ['NONE', 'MINIMAL', 'STANDARD', 'FULL'];

export const GUILD_STATUSES = ['ACTIVE', 'PAUSED', 'REMOVED'];

export const SOURCE_STATUSES = ['ACTIVE', 'PAUSED', 'BLOCKED'];

export const REPUTATION_LEVELS = ['NEW', 'ESTABLISHED', 'TRUSTED', 'EXEMPLARY', 'FLAGGED'];

export const JOB_TYPES = {
  RECALC_CONTRIBUTING_GUILDS: 'RECALC_CONTRIBUTING_GUILDS',
  RECALC_REPUTATION: 'RECALC_REPUTATION',
  RECALC_GLOBAL_VERIFICATION: 'RECALC_GLOBAL_VERIFICATION',
  REBUILD_GUILD_AGGREGATES: 'REBUILD_GUILD_AGGREGATES',
};

export const ACCESS_SCOPES = ['PUBLIC', 'MODERATOR', 'ADMIN'];

/**
 * Default profile_data_permissions applied when a guild registers with a
 * given data-sharing level. Categories absent from a level are disallowed.
 * This is where "a server decides what leaves the server" is encoded.
 */
export const DEFAULT_PERMISSIONS_BY_LEVEL = {
  FULL: {
    IDENTITY: { allowed: true, visibilityCeiling: 'GLOBAL' },
    ACTIVITY: { allowed: true, visibilityCeiling: 'GLOBAL' },
    ROLES: { allowed: true, visibilityCeiling: 'GUILD' },
    MODERATION: { allowed: true, visibilityCeiling: 'MODERATOR_ONLY' },
    VERIFICATION: { allowed: true, visibilityCeiling: 'GLOBAL' },
    REPUTATION: { allowed: true, visibilityCeiling: 'GLOBAL' },
    TIMELINE: { allowed: true, visibilityCeiling: 'GUILD' },
  },
  STANDARD: {
    IDENTITY: { allowed: true, visibilityCeiling: 'GUILD' },
    ACTIVITY: { allowed: true, visibilityCeiling: 'GLOBAL' },
    ROLES: { allowed: true, visibilityCeiling: 'GUILD' },
    MODERATION: { allowed: false, visibilityCeiling: 'MODERATOR_ONLY' },
    VERIFICATION: { allowed: true, visibilityCeiling: 'GLOBAL' },
    REPUTATION: { allowed: false, visibilityCeiling: 'GUILD' },
    TIMELINE: { allowed: false, visibilityCeiling: 'GUILD' },
  },
  MINIMAL: {
    IDENTITY: { allowed: true, visibilityCeiling: 'GUILD' },
    ACTIVITY: { allowed: false, visibilityCeiling: 'GUILD' },
    ROLES: { allowed: false, visibilityCeiling: 'GUILD' },
    MODERATION: { allowed: false, visibilityCeiling: 'MODERATOR_ONLY' },
    VERIFICATION: { allowed: false, visibilityCeiling: 'GUILD' },
    REPUTATION: { allowed: false, visibilityCeiling: 'GUILD' },
    TIMELINE: { allowed: false, visibilityCeiling: 'GUILD' },
  },
  NONE: {},
};

