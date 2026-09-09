-- ============================================================================
-- AZRA Global User Profile System — 001: core schema
-- Target: MySQL 8.0+  |  Engine: InnoDB  |  Charset: utf8mb4
--
-- This file is the production MySQL schema. The development JSON driver
-- (src/db/json/) mirrors these tables 1:1 — same names, same columns
-- (snake_case), same primary keys.
--
-- Design notes:
-- * Discord snowflakes are BIGINT UNSIGNED (fits 64-bit). The JSON driver
--   stores them as strings; mysql2 must run with supportBigNumbers +
--   bigNumberStrings to avoid JS precision loss.
-- * No FOREIGN KEYs by design: cross-guild write throughput and independent
--   guild lifecycle make FK cascades a liability at scale. Referential
--   integrity is enforced by the event processor; orphan cleanup is a
--   background job, not a cascading delete.
-- * All timestamps are UTC (DATETIME(3), ms precision).
-- * Every hot read path has a covering composite index; list endpoints use
--   keyset pagination on (sort_key DESC, id DESC).
-- ============================================================================

SET NAMES utf8mb4;

-- ---------------------------------------------------------------------------
-- Guild registry — participating communities and their sharing posture
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `guilds` (
  `guild_id`           BIGINT UNSIGNED NOT NULL,
  `name`               VARCHAR(100)    NOT NULL,
  `icon_hash`          VARCHAR(128)    NULL,
  `member_count`       INT UNSIGNED    NULL,
  `data_sharing_level` ENUM('NONE','MINIMAL','STANDARD','FULL') NOT NULL DEFAULT 'NONE',
  `is_participating`   TINYINT(1)      NOT NULL DEFAULT 0,
  `status`             ENUM('ACTIVE','PAUSED','REMOVED') NOT NULL DEFAULT 'ACTIVE',
  `first_seen_at`      DATETIME(3)     NOT NULL,
  `last_event_at`      DATETIME(3)     NULL,
  `created_at`         DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`         DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`guild_id`),
  KEY `idx_guilds_participation` (`is_participating`, `status`),
  KEY `idx_guilds_last_event` (`last_event_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ---------------------------------------------------------------------------
-- Global users — one row per Discord user AZRA has ever encountered
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `global_users` (
  `user_id`            BIGINT UNSIGNED NOT NULL,
  `username`           VARCHAR(32)     NULL,
  `global_name`        VARCHAR(32)     NULL,
  `avatar_hash`        VARCHAR(128)    NULL,
  `is_bot`             TINYINT(1)      NOT NULL DEFAULT 0,
  `account_created_at` DATETIME(3)     NULL,
  `first_seen_at`      DATETIME(3)     NOT NULL,
  `last_seen_at`       DATETIME(3)     NOT NULL,
  `created_at`         DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`         DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`user_id`),
  KEY `idx_global_users_last_seen` (`last_seen_at`),
  KEY `idx_global_users_username` (`username`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ---------------------------------------------------------------------------
-- Guild↔user relationship (server-specific layer)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `guild_user_profiles` (
  `guild_id`             BIGINT UNSIGNED NOT NULL,
  `user_id`              BIGINT UNSIGNED NOT NULL,
  `first_seen_at`        DATETIME(3)     NOT NULL,
  `last_seen_at`         DATETIME(3)     NOT NULL,
  `joined_at`            DATETIME(3)     NULL,
  `left_at`              DATETIME(3)     NULL,
  `membership_status`    ENUM('MEMBER','GUEST','PENDING','LEFT','BANNED') NOT NULL DEFAULT 'MEMBER',
  `nickname`             VARCHAR(32)     NULL,
  `avatar_hash`          VARCHAR(128)    NULL,
  `verification_status`  ENUM('UNVERIFIED','PENDING','VERIFIED','EXPIRED') NOT NULL DEFAULT 'UNVERIFIED',
  `data_sharing_enabled` TINYINT(1)      NOT NULL DEFAULT 1,
  `source_status`        ENUM('ACTIVE','PAUSED','BLOCKED') NOT NULL DEFAULT 'ACTIVE',
  `created_at`           DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`           DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`guild_id`, `user_id`),
  KEY `idx_gup_user_status` (`user_id`, `membership_status`),
  KEY `idx_gup_guild_seen` (`guild_id`, `membership_status`, `last_seen_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ---------------------------------------------------------------------------
-- Guild → AZRA data-sharing permissions (default-deny per category)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `profile_data_permissions` (
  `guild_id`           BIGINT UNSIGNED NOT NULL,
  `data_category`      ENUM('IDENTITY','ACTIVITY','ROLES','MODERATION','VERIFICATION','REPUTATION','TIMELINE') NOT NULL,
  `is_allowed`         TINYINT(1)      NOT NULL DEFAULT 0,
  `visibility_ceiling` ENUM('GLOBAL','GUILD','MODERATOR_ONLY','PRIVATE') NOT NULL DEFAULT 'GUILD',
  `updated_by_user_id` BIGINT UNSIGNED NULL,
  `created_at`         DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`         DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`guild_id`, `data_category`),
  KEY `idx_pdp_allowed` (`data_category`, `is_allowed`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ---------------------------------------------------------------------------
-- Data provenance — every accepted event's origin, visibility, authorization
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `profile_data_sources` (
  `event_id`            VARCHAR(128)    NOT NULL,
  `source_guild_id`     BIGINT UNSIGNED NULL,
  `source_type`         ENUM('GUILD_EVENT','GUILD_ADMIN','GLOBAL_ADMIN','AZRA_SYSTEM','USER_SELF_REPORT') NOT NULL,
  `source_ref`          VARCHAR(190)    NULL,
  `visibility`          ENUM('GLOBAL','GUILD','MODERATOR_ONLY','PRIVATE') NOT NULL,
  `authorization_status` ENUM('AUTHORIZED','PENDING','DENIED','REVOKED') NOT NULL DEFAULT 'PENDING',
  `recorded_at`         DATETIME(3)     NOT NULL,
  `created_at`          DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`event_id`),
  KEY `idx_pds_guild` (`source_guild_id`, `recorded_at`),
  KEY `idx_pds_auth` (`authorization_status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ---------------------------------------------------------------------------
-- Event idempotency ledger — duplicate Discord events are no-ops
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `processed_events` (
  `event_id`     VARCHAR(128)    NOT NULL,
  `event_type`   VARCHAR(64)     NULL,
  `guild_id`     BIGINT UNSIGNED NULL,
  `user_id`      BIGINT UNSIGNED NULL,
  `status`       ENUM('RECEIVED','PROCESSED','REJECTED','SKIPPED','FAILED') NOT NULL DEFAULT 'RECEIVED',
  `attempts`     INT UNSIGNED    NOT NULL DEFAULT 1,
  `last_error`   VARCHAR(512)    NULL,
  `processed_at` DATETIME(3)     NULL,
  `created_at`   DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`event_id`),
  KEY `idx_pe_status_time` (`status`, `created_at`),
  KEY `idx_pe_guild_time` (`guild_id`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ---------------------------------------------------------------------------
-- Global verification aggregate (recomputed only from authorized sources)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `global_verification` (
  `user_id`            BIGINT UNSIGNED NOT NULL,
  `status`             ENUM('UNKNOWN','UNVERIFIED','PENDING','VERIFIED','FLAGGED') NOT NULL DEFAULT 'UNKNOWN',
  `highest_level`      ENUM('NONE','GUILD','CROSS_GUILD','GLOBAL') NOT NULL DEFAULT 'NONE',
  `verified_at`        DATETIME(3)     NULL,
  `last_verified_at`   DATETIME(3)     NULL,
  `confirming_guilds`  INT UNSIGNED    NOT NULL DEFAULT 0,
  `updated_at`         DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`user_id`),
  KEY `idx_gv_status` (`status`, `confirming_guilds`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ---------------------------------------------------------------------------
-- Global badges (natural key: user + badge)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `global_badges` (
  `user_id`             BIGINT UNSIGNED NOT NULL,
  `badge_key`           VARCHAR(64)     NOT NULL,
  `awarded_by_guild_id` BIGINT UNSIGNED NULL,
  `awarded_by_user_id`  BIGINT UNSIGNED NULL,
  `awarded_at`          DATETIME(3)     NOT NULL,
  `revoked_at`          DATETIME(3)     NULL,
  `revoked_reason`      VARCHAR(255)    NULL,
  `source_event_id`     VARCHAR(128)    NULL,
  `created_at`          DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`user_id`, `badge_key`),
  KEY `idx_gb_user_active` (`user_id`, `revoked_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ---------------------------------------------------------------------------
-- Global achievements
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `global_achievements` (
  `user_id`          BIGINT UNSIGNED NOT NULL,
  `achievement_key`  VARCHAR(64)     NOT NULL,
  `tier`             TINYINT UNSIGNED NOT NULL DEFAULT 1,
  `achieved_at`      DATETIME(3)     NOT NULL,
  `source_guild_id`  BIGINT UNSIGNED NULL,
  `source_event_id`  VARCHAR(128)    NULL,
  `created_at`       DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`user_id`, `achievement_key`),
  KEY `idx_ga_user_time` (`user_id`, `achieved_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ---------------------------------------------------------------------------
-- Global activity totals (aggregated counters — never raw history)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `global_activity` (
  `user_id`             BIGINT UNSIGNED NOT NULL,
  `messages_seen`       BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `reactions_added`     BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `voice_minutes`       BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `commands_used`       BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `active_days`         INT UNSIGNED    NOT NULL DEFAULT 0,
  `contributing_guilds` INT UNSIGNED    NOT NULL DEFAULT 0,
  `first_active_at`     DATETIME(3)     NULL,
  `last_active_at`      DATETIME(3)     NULL,
  `updated_at`          DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`user_id`),
  KEY `idx_gact_last_active` (`last_active_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ---------------------------------------------------------------------------
-- Global activity daily buckets (time-series without full-history scans)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `global_activity_daily` (
  `user_id`         BIGINT UNSIGNED NOT NULL,
  `activity_date`   DATE            NOT NULL,
  `messages_seen`   BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `reactions_added` BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `voice_minutes`   BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `commands_used`   BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `updated_at`      DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`user_id`, `activity_date`),
  KEY `idx_gad_date` (`activity_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ---------------------------------------------------------------------------
-- Global reputation (recomputed by the aggregation worker)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `global_reputation` (
  `user_id`          BIGINT UNSIGNED NOT NULL,
  `reputation_score` INT             NOT NULL DEFAULT 0,
  `level`            ENUM('NEW','ESTABLISHED','TRUSTED','EXEMPLARY','FLAGGED') NOT NULL DEFAULT 'NEW',
  `positive_signals` INT UNSIGNED    NOT NULL DEFAULT 0,
  `negative_signals` INT UNSIGNED    NOT NULL DEFAULT 0,
  `breakdown`        JSON            NULL,
  `calculated_at`    DATETIME(3)     NULL,
  `updated_at`       DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`user_id`),
  KEY `idx_gr_score` (`reputation_score`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ---------------------------------------------------------------------------
-- Global restrictions (platform-level; GLOBAL_ADMIN source only)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `global_restrictions` (
  `id`                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`            BIGINT UNSIGNED NOT NULL,
  `restriction_type`   ENUM('GLOBAL_BAN','GLOBAL_MUTE','VERIFICATION_HOLD','SANCTION') NOT NULL,
  `reason`             VARCHAR(500)    NULL,
  `source_guild_id`    BIGINT UNSIGNED NULL,
  `issued_by_user_id`  BIGINT UNSIGNED NULL,
  `starts_at`          DATETIME(3)     NOT NULL,
  `expires_at`         DATETIME(3)     NULL,
  `status`             ENUM('ACTIVE','EXPIRED','LIFTED','APPEALED') NOT NULL DEFAULT 'ACTIVE',
  `lifted_at`          DATETIME(3)     NULL,
  `lifted_by_user_id`  BIGINT UNSIGNED NULL,
  `source_event_id`    VARCHAR(128)    NULL,
  `created_at`         DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`         DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_gres_user_active` (`user_id`, `status`),
  KEY `idx_gres_expiry` (`status`, `expires_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ---------------------------------------------------------------------------
-- Global timeline — the community-history feed (keyset paginated)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `global_timeline` (
  `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`         BIGINT UNSIGNED NOT NULL,
  `occurred_at`     DATETIME(3)     NOT NULL,
  `event_type`      VARCHAR(64)     NOT NULL,
  `guild_id`        BIGINT UNSIGNED NULL,
  `summary`         VARCHAR(255)    NOT NULL,
  `details`         JSON            NULL,
  `visibility`      ENUM('GLOBAL','GUILD','MODERATOR_ONLY','PRIVATE') NOT NULL,
  `source_event_id` VARCHAR(128)    NULL,
  `created_at`      DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_gt_user_time` (`user_id`, `occurred_at` DESC, `id` DESC),
  KEY `idx_gt_guild_time` (`guild_id`, `occurred_at` DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ---------------------------------------------------------------------------
-- Guild-local moderation history (reasons NEVER leave this layer unless the
-- guild's MODERATION permission allows it)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `guild_user_moderation` (
  `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `guild_id`        BIGINT UNSIGNED NOT NULL,
  `user_id`         BIGINT UNSIGNED NOT NULL,
  `case_id`         VARCHAR(64)     NULL,
  `action_type`     ENUM('WARN','TIMEOUT','KICK','BAN','UNBAN','MUTE','NOTE') NOT NULL,
  `reason`          VARCHAR(500)    NULL,
  `moderator_id`    BIGINT UNSIGNED NULL,
  `issued_at`       DATETIME(3)     NOT NULL,
  `expires_at`      DATETIME(3)     NULL,
  `active`          TINYINT(1)      NOT NULL DEFAULT 0,
  `lifted_at`       DATETIME(3)     NULL,
  `source_event_id` VARCHAR(128)    NULL,
  `created_at`      DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_gum_source_event` (`source_event_id`),
  KEY `idx_gum_guild_user` (`guild_id`, `user_id`, `issued_at` DESC),
  KEY `idx_gum_user` (`user_id`, `issued_at` DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ---------------------------------------------------------------------------
-- Guild↔user activity counters (aggregated; source of global rebuilds)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `guild_user_activity` (
  `guild_id`        BIGINT UNSIGNED NOT NULL,
  `user_id`         BIGINT UNSIGNED NOT NULL,
  `messages_seen`   BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `reactions_added` BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `voice_minutes`   BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `commands_used`   BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `first_active_at` DATETIME(3)     NULL,
  `last_active_at`  DATETIME(3)     NULL,
  `updated_at`      DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`guild_id`, `user_id`),
  KEY `idx_gua_user` (`user_id`, `last_active_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ---------------------------------------------------------------------------
-- Guild roles (current membership: removed_at IS NULL)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `guild_user_roles` (
  `id`                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `guild_id`           BIGINT UNSIGNED NOT NULL,
  `user_id`            BIGINT UNSIGNED NOT NULL,
  `role_id`            BIGINT UNSIGNED NOT NULL,
  `role_name`          VARCHAR(100)    NULL,
  `role_position`      INT             NULL,
  `added_at`           DATETIME(3)     NOT NULL,
  `removed_at`         DATETIME(3)     NULL,
  `granted_by_user_id` BIGINT UNSIGNED NULL,
  `source_event_id`    VARCHAR(128)    NULL,
  `created_at`         DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_gur_active` (`guild_id`, `user_id`, `removed_at`),
  KEY `idx_gur_role` (`guild_id`, `role_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ---------------------------------------------------------------------------
-- Guild-local verification (latest state per guild↔user)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `guild_user_verification` (
  `guild_id`            BIGINT UNSIGNED NOT NULL,
  `user_id`             BIGINT UNSIGNED NOT NULL,
  `method`              ENUM('RULES_GATE','ROLE','CAPTCHA','MANUAL','EXTERNAL') NOT NULL DEFAULT 'MANUAL',
  `status`              ENUM('PENDING','VERIFIED','FAILED','EXPIRED') NOT NULL DEFAULT 'PENDING',
  `verified_at`         DATETIME(3)     NULL,
  `verified_by_user_id` BIGINT UNSIGNED NULL,
  `expires_at`          DATETIME(3)     NULL,
  `source_event_id`     VARCHAR(128)    NULL,
  `created_at`          DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`          DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`guild_id`, `user_id`),
  KEY `idx_guv_status` (`guild_id`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ---------------------------------------------------------------------------
-- Profile access audit log
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `profile_access_logs` (
  `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `viewer_id`       BIGINT UNSIGNED NULL,
  `target_user_id`  BIGINT UNSIGNED NOT NULL,
  `guild_id`        BIGINT UNSIGNED NULL,
  `access_scope`    ENUM('PUBLIC','MODERATOR','ADMIN') NOT NULL,
  `fields_accessed` JSON            NULL,
  `outcome`         ENUM('ALLOWED','DENIED','PARTIAL') NOT NULL,
  `deny_reason`     VARCHAR(255)    NULL,
  `accessed_at`     DATETIME(3)     NOT NULL,
  `created_at`      DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_pal_target` (`target_user_id`, `accessed_at` DESC),
  KEY `idx_pal_viewer` (`viewer_id`, `accessed_at` DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ---------------------------------------------------------------------------
-- Aggregation job queue (background processing; FOR UPDATE SKIP LOCKED poll)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `aggregation_queue` (
  `id`           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `job_type`     ENUM('RECALC_CONTRIBUTING_GUILDS','RECALC_REPUTATION','RECALC_GLOBAL_VERIFICATION','REBUILD_GUILD_AGGREGATES') NOT NULL,
  `entity_type`  ENUM('USER','GUILD') NOT NULL,
  `entity_id`    BIGINT UNSIGNED NOT NULL,
  `priority`     TINYINT UNSIGNED NOT NULL DEFAULT 5,
  `status`       ENUM('PENDING','RUNNING','DONE','FAILED') NOT NULL DEFAULT 'PENDING',
  `attempts`     INT UNSIGNED    NOT NULL DEFAULT 0,
  `max_attempts` INT UNSIGNED    NOT NULL DEFAULT 5,
  `run_after`    DATETIME(3)     NOT NULL,
  `locked_by`    VARCHAR(64)     NULL,
  `locked_at`    DATETIME(3)     NULL,
  `last_error`   VARCHAR(512)    NULL,
  `created_at`   DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `completed_at` DATETIME(3)     NULL,
  PRIMARY KEY (`id`),
  KEY `idx_aq_poll` (`status`, `priority`, `run_after`),
  KEY `idx_aq_entity` (`job_type`, `entity_id`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ============================================================================
-- End of migration 001.
-- ============================================================================





