/**
 * Emoji/icon registry — maps every AZRA domain value to a Discord-safe emoji.
 * These power both the profile embed and the rendered profile card.
 *  Unknown keys → sensible fallbacks, never throw.
 */

// Reputation levels.
export const LEVEL_EMOJI = {
  NEW: '🌱',
  ESTABLISHED: '🌿',
  TRUSTED: '🛡️',
  EXEMPLARY: '👑',
  FLAGGED: '🚩',
};

// Data coverage.
export const COVERAGE_EMOJI = {
  FULL: '✅',
  PARTIAL: '⚠️',
  NONE: '🚫',
  NO_COMMUNITIES: '🌐',
};

// Badges — fallback 🏅.
export const BADGE_EMOJI = {
  BUG_HUNTER: '🐛',
  EARLY_SUPPORTER: '🎗️',
  COMMUNITY_PILLAR: '🏛️',
  EVENT_ORGANIZER: '🎪',
  PEACEKEEPER: '🕊️',
  WELCOME_WAGON: '👋',
  RAID_ASSAULT: '🪖',
  POLICY_SCHOLAR: '📖',
  LONGEVITY: '🗓️',
  HELPER: '🛟',
  DEFAULT: '🏅',
};

// Achievements — fallback 🏆.
export const ACHIEVEMENT_EMOJI = {
  CONVERSATION_STARTER: '💬',
  MARATHON_RUNNER: '🏃',
  FIRST_STEPS: '🌱',
  LEVEL_10: '🔟',
  NIGHT_OWL: '🌙',
  EARLY_RISER: '🌅',
  COMEBACK_KID: '🔄',
  DEFAULT: '🏆',
};

// Activity kinds.
export const ACTIVITY_EMOJI = {
  message: '💬',
  reaction: '👍',
  voice: '🎙️',
  command: '⌨️',
};

// Discord/domain event types (used on the timeline and moderation lists).
export const EVENT_EMOJI = {
  GUILD_REGISTER: '➕',
  GUILD_UPDATE: '🛠️',
  USER_UPSERT: '🧑',
  MEMBER_JOINED: '🔑',
  MEMBER_LEFT: '➖',
  ACTIVITY_MESSAGE: '💬',
  ACTIVITY_VOICE: '🎙️',
  ACTIVITY_REACTION: '👍',
  ACTIVITY_COMMAND: '⌨️',
  ROLE_ADDED: '🧩',
  ROLE_REMOVED: '🗑️',
  VERIFICATION_COMPLETED: '✅',
  VERIFICATION_FAILED: '❌',
  MODERATION_ACTION: '🚨',
  BADGE_AWARDED: '🏅',
  BADGE_REVOKED: '📛',
  ACHIEVEMENT_UNLOCKED: '🏆',
  REPUTATION_SIGNAL: '📈',
  RESTRICTION_APPLIED: '⛔',
  RESTRICTION_LIFTED: '🔓',
  DEFAULT: '📌',
};

// Moderation action types (used in moderation fields).
export const MODERATION_EMOJI = {
  WARN: '⚠️',
  TIMEOUT: '⏳',
  KICK: '👢',
  BAN: '🔨',
  UNBAN: '🔓',
  MUTE: '🙊',
  NOTE: '🗒️',
  DEFAULT: '🚨',
};

// Verification statuses (profile-status display).
export const VERIFICATION_EMOJI = {
  UNKNOWN: '❓',
  UNVERIFIED: '🔒',
  PENDING: '🕓',
  VERIFIED: '✅',
  EXPIRED: '⏰',
  FLAGGED: '🚩',
  DEFAULT: '❓',
};

// Membership statuses.
export const MEMBERSHIP_EMOJI = {
  MEMBER: '👥',
  GUEST: '🧑‍🤝‍🧑',
  PENDING: '🕓',
  LEFT: '➖',
  BANNED: '🔨',
  DEFAULT: '👤',
};

function emojiFor(map, key) {
  if (key == null) return map.DEFAULT;
  const value = map[String(key)];
  return value ?? map.DEFAULT;
}

export function badgeEmoji(key) {
  return emojiFor(BADGE_EMOJI, key);
}

export function achievementEmoji(key) {
  return emojiFor(ACHIEVEMENT_EMOJI, key);
}

export function eventEmoji(type) {
  return emojiFor(EVENT_EMOJI, type);
}

export function activityEmoji(kind) {
  return emojiFor(ACTIVITY_EMOJI, kind);
}

export function moderationEmoji(actionType) {
  return emojiFor(MODERATION_EMOJI, actionType);
}

export function levelEmoji(level) {
  return emojiFor(LEVEL_EMOJI, level);
}

export function verificationEmoji(status) {
  return emojiFor(VERIFICATION_EMOJI, status);
}

/** Renders a simple text-based mini bar chart for daily activity.
 *  e.g. [2,5,0,8,3] → "▰▰▰▯▰ ▮▮▮▯▮ ▮▮▮▯▮" — pure helper, embed + card both use it. */
export function miniBar(values, { width = 7, filled = '▮', empty = '▯' } = {}) {
  const nums = values.map((v) => Math.max(0, Number(v) || 0));
  if (nums.length === 0) return '';
  const max = Math.max(...nums, 1);
  return nums
    .map((v) => {
      const fill = Math.round((v / max) * width);
      return filled.repeat(Math.max(0, Math.min(width, fill))) + empty.repeat(Math.max(0, width - Math.max(0, Math.min(width, fill))));
    })
    .join(' ');
}