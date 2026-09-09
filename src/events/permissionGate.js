import * as guilds from '../models/guilds.model.js';
import * as dataPermissions from '../models/dataPermissions.model.js';
import * as guildProfiles from '../models/guildProfiles.model.js';
import {
  EVENT_TYPES,
  EVENT_CATEGORY,
  CATEGORY_DEFAULT_VISIBILITY,
  VISIBILITY,
  VISIBILITY_RANK,
} from './eventTypes.js';

function deny(reason, event) {
  return {
    allowed: false,
    reason,
    visibility: null,
    sourceType: event.sourceType,
    authorizationStatus: 'DENIED',
    category: EVENT_CATEGORY[event.type] ?? null,
    guild: null,
    permission: null,
    profile: null,
  };
}

/** The category's desired visibility, capped by the guild's ceiling. */
function capVisibility(category, ceiling) {
  const wanted = CATEGORY_DEFAULT_VISIBILITY[category] ?? VISIBILITY.GUILD;
  const wantedRank = VISIBILITY_RANK[wanted] ?? 0;
  const ceilingRank = VISIBILITY_RANK[ceiling] ?? 0;
  return ceilingRank <= wantedRank ? ceiling : wanted;
}

function allow(event, partial) {
  return {
    allowed: true,
    reason: 'authorized',
    sourceType: event.sourceType,
    authorizationStatus: 'AUTHORIZED',
    guild: null,
    permission: null,
    profile: null,
    ...partial,
  };
}

/**
 * Decides whether an event may write to the store, and at what visibility.
 *
 * Data flows left-to-right only: a single server's data NEVER becomes global
 * truth unless the guild is registered, participating, and has explicitly
 * allowed the event's data category. Users can additionally opt out per
 * guild (data_sharing_enabled) or be blocked per guild (source_status).
 */
export async function evaluate(event) {
  // System path — guild management events create/modify the guild itself.
  if (event.type === EVENT_TYPES.GUILD_REGISTER || event.type === EVENT_TYPES.GUILD_UPDATE) {
    const guild = await guilds.getGuild(event.guildId);
    if (event.type === EVENT_TYPES.GUILD_UPDATE && !guild) {
      return deny('guild is not registered with AZRA', event);
    }
    return allow(event, {
      reason: 'system:guild-management',
      visibility: VISIBILITY.GUILD,
      category: null,
      guild,
    });
  }

  // Admin path — platform-level restrictions require the GLOBAL_ADMIN source.
  if (event.type === EVENT_TYPES.RESTRICTION_APPLIED || event.type === EVENT_TYPES.RESTRICTION_LIFTED) {
    if (event.sourceType !== 'GLOBAL_ADMIN') {
      return deny('global restrictions require the GLOBAL_ADMIN source type', event);
    }
    return allow(event, {
      reason: 'admin:global-restriction',
      visibility: VISIBILITY.GLOBAL,
      category: null,
    });
  }

  // Guild path.
  if (!event.guildId) return deny('event has no guild context', event);

  const guild = await guilds.getGuild(event.guildId);
  if (!guild) return deny('guild is not registered with AZRA', event);
  if (guild.status !== 'ACTIVE') return deny(`guild status is ${guild.status}`, event);
  if (!guild.is_participating) {
    return deny('guild is not participating in global profile data sharing', event);
  }

  const category = EVENT_CATEGORY[event.type];
  const permission = await dataPermissions.getPermission(event.guildId, category);
  if (!permission || !permission.is_allowed) {
    return deny(`data sharing for category ${category} is not permitted by this guild`, event);
  }

  const profile = event.userId
    ? await guildProfiles.getGuildUser(event.guildId, event.userId)
    : null;
  if (profile?.source_status === 'BLOCKED') {
    return deny('data source is blocked for this user in this guild', event);
  }
  if (profile && profile.data_sharing_enabled === false) {
    return deny('user opted out of data sharing in this guild', event);
  }

  return allow(event, {
    visibility: capVisibility(category, permission.visibility_ceiling),
    category,
    guild,
    permission,
    profile,
  });
}
