import { GUILD_DATA_SHARING_LEVELS } from '../src/domain/catalog.js';
import { ValidationError } from '../src/utils/errors.js';

/**
 * Pure mapping helpers between Discord shapes and AZRA events. Kept free of
 * discord.js imports so they are unit-testable without a gateway connection.
 */

/** Deterministic, collision-safe event id from arbitrary parts. */
export function deterministicEventId(...parts) {
  return parts.map((p) => String(p ?? '')).join(':');
}

/** Discord permission snapshot → AZRA viewer scope. */
export function viewerScopeFromPermissions(perms = {}) {
  if (perms.administrator) return 'ADMIN';
  if (perms.moderateMembers || perms.manageMessages || perms.manageGuild) return 'MODERATOR';
  return 'PUBLIC';
}

/** discord.js User (or plain shape) → global_users upsert payload. */
export function identityPayloadFromUser(user = {}) {
  return {
    userId: String(user.id),
    username: user.username ?? null,
    globalName: user.globalName ?? user.displayName ?? null,
    avatarHash: user.avatar ?? null,
    isBot: Boolean(user.bot),
    accountCreatedAt: user.createdAt ?? null,
  };
}

/** discord.js Guild (or plain shape) → guild registration payload. */
export function guildPayloadFromGuild(guild = {}) {
  return {
    name: guild.name ?? null,
    memberCount: guild.memberCount ?? null,
    iconHash: guild.icon ?? null,
  };
}

/** Diff two [{ id, name, position }] role lists into { added, removed }. */
export function diffRoles(oldRoles = [], newRoles = []) {
  const byId = (list) => new Map(list.map((r) => [String(r.id), r]));
  const oldMap = byId(oldRoles);
  const newMap = byId(newRoles);
  const added = [...newMap.values()].filter((r) => !oldMap.has(String(r.id)));
  const removed = [...oldMap.values()].filter((r) => !newMap.has(String(r.id)));
  return { added, removed };
}

export function assertSharingLevel(level) {
  if (!GUILD_DATA_SHARING_LEVELS.includes(level)) {
    throw new ValidationError(
      `Invalid sharing level "${level}" (expected one of: ${GUILD_DATA_SHARING_LEVELS.join(', ')})`,
    );
  }
  return level;
}

/** True when a fresh timeout appeared on a member update. */
export function timeoutChanged(oldMember, newMember) {
  const oldUntil = oldMember?.communicationDisabledUntilTimestamp ?? null;
  const newUntil = newMember?.communicationDisabledUntilTimestamp ?? null;
  return newUntil != null && newUntil > Date.now() && newUntil !== oldUntil;
}

/** Sharing-level → human description for command replies. */
export function sharingLevelDescription(level) {
  switch (level) {
    case 'FULL':
      return 'Identity, activity, roles, moderation, verification, reputation and timeline data may feed global profiles.';
    case 'STANDARD':
      return 'Identity, activity, roles and verification feed global profiles; moderation and reputation stay guild-local.';
    case 'MINIMAL':
      return 'Only basic identity data stays visible globally; everything else stays guild-local.';
    default:
      return 'No data leaves this server. AZRA stores nothing globally for it.';
  }
}
