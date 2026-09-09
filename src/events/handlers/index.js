import * as identity from './identityHandlers.js';
import * as activityHandlers from './activityHandlers.js';
import * as roleHandlers from './roleHandlers.js';
import * as verificationHandlers from './verificationHandlers.js';
import * as moderationHandlers from './moderationHandlers.js';
import * as recognitionHandlers from './recognitionHandlers.js';
import * as restrictionHandlers from './restrictionHandlers.js';
import { EVENT_TYPES } from '../../domain/catalog.js';

/** event type → handler(event, decision). All handlers run inside the
 *  processor's transaction; every model call joins it via async context. */
export const HANDLERS = {
  [EVENT_TYPES.GUILD_REGISTER]: identity.guildRegister,
  [EVENT_TYPES.GUILD_UPDATE]: identity.guildUpdate,
  [EVENT_TYPES.USER_UPSERT]: identity.userUpsert,
  [EVENT_TYPES.MEMBER_JOINED]: identity.memberJoined,
  [EVENT_TYPES.MEMBER_LEFT]: identity.memberLeft,
  [EVENT_TYPES.ACTIVITY_MESSAGE]: activityHandlers.activityMessage,
  [EVENT_TYPES.ACTIVITY_VOICE]: activityHandlers.activityVoice,
  [EVENT_TYPES.ACTIVITY_REACTION]: activityHandlers.activityReaction,
  [EVENT_TYPES.ACTIVITY_COMMAND]: activityHandlers.activityCommand,
  [EVENT_TYPES.ROLE_ADDED]: roleHandlers.roleAdded,
  [EVENT_TYPES.ROLE_REMOVED]: roleHandlers.roleRemoved,
  [EVENT_TYPES.VERIFICATION_COMPLETED]: verificationHandlers.verificationCompleted,
  [EVENT_TYPES.VERIFICATION_FAILED]: verificationHandlers.verificationFailed,
  [EVENT_TYPES.MODERATION_ACTION]: moderationHandlers.moderationAction,
  [EVENT_TYPES.BADGE_AWARDED]: recognitionHandlers.badgeAwarded,
  [EVENT_TYPES.BADGE_REVOKED]: recognitionHandlers.badgeRevoked,
  [EVENT_TYPES.ACHIEVEMENT_UNLOCKED]: recognitionHandlers.achievementUnlocked,
  [EVENT_TYPES.REPUTATION_SIGNAL]: recognitionHandlers.reputationSignal,
  [EVENT_TYPES.RESTRICTION_APPLIED]: restrictionHandlers.restrictionApplied,
  [EVENT_TYPES.RESTRICTION_LIFTED]: restrictionHandlers.restrictionLifted,
};
