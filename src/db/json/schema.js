/**
 * Logical table registry — mirrors src/migrations/001_global_profile_schema.sql
 * table-for-table. The JSON driver stores one file per table in AZRA_DATA_DIR.
 *
 * pk: function extracting the primary key from a row.
 *   - Discord snowflake PKs stay strings (JSON numbers lose precision > 2^53).
 *   - Composite PKs are rendered as `a:b` strings (equivalent to the SQL
 *     composite primary keys).
 * autoIncrement: table exposes a monotonically increasing id (SQL AUTO_INCREMENT).
 */
export const TABLE_NAMES = {
  GLOBAL_USERS: 'global_users',
  GLOBAL_VERIFICATION: 'global_verification',
  GLOBAL_BADGES: 'global_badges',
  GLOBAL_ACHIEVEMENTS: 'global_achievements',
  GLOBAL_ACTIVITY: 'global_activity',
  GLOBAL_ACTIVITY_DAILY: 'global_activity_daily',
  GLOBAL_REPUTATION: 'global_reputation',
  GLOBAL_RESTRICTIONS: 'global_restrictions',
  GLOBAL_TIMELINE: 'global_timeline',
  GUILDS: 'guilds',
  GUILD_USER_PROFILES: 'guild_user_profiles',
  GUILD_USER_MODERATION: 'guild_user_moderation',
  GUILD_USER_ACTIVITY: 'guild_user_activity',
  GUILD_USER_ROLES: 'guild_user_roles',
  GUILD_USER_VERIFICATION: 'guild_user_verification',
  PROFILE_DATA_PERMISSIONS: 'profile_data_permissions',
  PROFILE_DATA_SOURCES: 'profile_data_sources',
  PROFILE_ACCESS_LOGS: 'profile_access_logs',
  PROCESSED_EVENTS: 'processed_events',
  AGGREGATION_QUEUE: 'aggregation_queue',
};

const guildPk = (r) => r.guild_id;
const userPk = (r) => r.user_id;
const guildUserPk = (r) => `${r.guild_id}:${r.user_id}`;
const autoIdPk = (r) => String(r.id);

export const TABLE_SCHEMAS = {
  [TABLE_NAMES.GLOBAL_USERS]: { pk: userPk },
  [TABLE_NAMES.GLOBAL_VERIFICATION]: { pk: userPk },
  [TABLE_NAMES.GLOBAL_BADGES]: { pk: (r) => `${r.user_id}:${r.badge_key}` },
  [TABLE_NAMES.GLOBAL_ACHIEVEMENTS]: { pk: (r) => `${r.user_id}:${r.achievement_key}` },
  [TABLE_NAMES.GLOBAL_ACTIVITY]: { pk: userPk },
  [TABLE_NAMES.GLOBAL_ACTIVITY_DAILY]: { pk: (r) => `${r.user_id}:${r.activity_date}` },
  [TABLE_NAMES.GLOBAL_REPUTATION]: { pk: userPk },
  [TABLE_NAMES.GLOBAL_RESTRICTIONS]: { pk: autoIdPk, autoIncrement: true },
  [TABLE_NAMES.GLOBAL_TIMELINE]: { pk: autoIdPk, autoIncrement: true },
  [TABLE_NAMES.GUILDS]: { pk: guildPk },
  [TABLE_NAMES.GUILD_USER_PROFILES]: { pk: guildUserPk },
  [TABLE_NAMES.GUILD_USER_MODERATION]: { pk: autoIdPk, autoIncrement: true },
  [TABLE_NAMES.GUILD_USER_ACTIVITY]: { pk: guildUserPk },
  [TABLE_NAMES.GUILD_USER_ROLES]: { pk: autoIdPk, autoIncrement: true },
  [TABLE_NAMES.GUILD_USER_VERIFICATION]: { pk: guildUserPk },
  [TABLE_NAMES.PROFILE_DATA_PERMISSIONS]: { pk: (r) => `${r.guild_id}:${r.data_category}` },
  [TABLE_NAMES.PROFILE_DATA_SOURCES]: { pk: (r) => r.event_id },
  [TABLE_NAMES.PROFILE_ACCESS_LOGS]: { pk: autoIdPk, autoIncrement: true },
  [TABLE_NAMES.PROCESSED_EVENTS]: { pk: (r) => r.event_id },
  [TABLE_NAMES.AGGREGATION_QUEUE]: { pk: autoIdPk, autoIncrement: true },
};

/** Empty row templates with storage-layer defaults. */
export function blankRow(tableName, pkValue) {
  const now = new Date().toISOString();
  switch (tableName) {
    case TABLE_NAMES.GLOBAL_USERS:
      return {
        user_id: pkValue, username: null, global_name: null, avatar_hash: null,
        is_bot: false, account_created_at: null, first_seen_at: now, last_seen_at: now,
        created_at: now, updated_at: now,
      };
    case TABLE_NAMES.GLOBAL_VERIFICATION:
      return {
        user_id: pkValue, status: 'UNKNOWN', highest_level: 'NONE', verified_at: null,
        last_verified_at: null, confirming_guilds: 0, updated_at: now,
      };
    case TABLE_NAMES.GLOBAL_ACTIVITY:
      return {
        user_id: pkValue, messages_seen: 0, reactions_added: 0, voice_minutes: 0,
        commands_used: 0, active_days: 0, contributing_guilds: 0,
        first_active_at: null, last_active_at: null, updated_at: now,
      };
    case TABLE_NAMES.GLOBAL_ACTIVITY_DAILY:
      return {
        user_id: pkValue.split(':')[0], activity_date: pkValue.split(':')[1],
        messages_seen: 0, reactions_added: 0, voice_minutes: 0, commands_used: 0, updated_at: now,
      };
    case TABLE_NAMES.GLOBAL_REPUTATION:
      return {
        user_id: pkValue, reputation_score: 0, level: 'NEW', positive_signals: 0,
        negative_signals: 0, breakdown: null, calculated_at: null, updated_at: now,
      };
    case TABLE_NAMES.GUILDS:
      return {
        guild_id: pkValue, name: null, icon_hash: null, member_count: null,
        data_sharing_level: 'NONE', is_participating: false, status: 'ACTIVE',
        first_seen_at: now, last_event_at: null, created_at: now, updated_at: now,
      };
    case TABLE_NAMES.GUILD_USER_PROFILES:
      return {
        guild_id: pkValue.split(':')[0], user_id: pkValue.split(':')[1],
        first_seen_at: now, last_seen_at: now, joined_at: null, left_at: null,
        membership_status: 'MEMBER', nickname: null, avatar_hash: null,
        verification_status: 'UNVERIFIED', data_sharing_enabled: true,
        source_status: 'ACTIVE', created_at: now, updated_at: now,
      };
    case TABLE_NAMES.GUILD_USER_ACTIVITY:
      return {
        guild_id: pkValue.split(':')[0], user_id: pkValue.split(':')[1],
        messages_seen: 0, reactions_added: 0, voice_minutes: 0, commands_used: 0,
        first_active_at: null, last_active_at: null, updated_at: now,
      };
    case TABLE_NAMES.GUILD_USER_VERIFICATION:
      return {
        guild_id: pkValue.split(':')[0], user_id: pkValue.split(':')[1],
        method: 'MANUAL', status: 'PENDING', verified_at: null, verified_by_user_id: null,
        expires_at: null, source_event_id: null, created_at: now, updated_at: now,
      };
    case TABLE_NAMES.PROFILE_DATA_PERMISSIONS:
      return {
        guild_id: pkValue.split(':')[0], data_category: pkValue.split(':')[1],
        is_allowed: false, visibility_ceiling: 'GUILD', updated_by_user_id: null,
        created_at: now, updated_at: now,
      };
    default:
      throw new Error(`No blank row template for table "${tableName}"`);
  }
}

