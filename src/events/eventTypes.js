/**
 * Event-type surface. The canonical definitions live in src/domain/catalog.js
 * (single source of truth shared with validators, the gate and handlers);
 * this module is the stable import point for event-producing code.
 */
export {
  EVENT_TYPES,
  EVENT_CATEGORY,
  DATA_CATEGORIES,
  VISIBILITY,
  VISIBILITY_RANK,
  CATEGORY_DEFAULT_VISIBILITY,
  SOURCE_TYPES,
  AUTHORIZATION_STATUSES,
  ACTIVITY_KINDS,
  ACTIVITY_COUNTER_FIELD,
  MODERATION_ACTION_TYPES,
  RESTRICTION_TYPES,
  VERIFICATION_METHODS,
  GUILD_DATA_SHARING_LEVELS,
  JOB_TYPES,
  ACCESS_SCOPES,
  DEFAULT_PERMISSIONS_BY_LEVEL,
} from '../domain/catalog.js';
