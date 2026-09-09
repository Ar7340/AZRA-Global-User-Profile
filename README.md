# AZRA Global User Profile System

A production-ready **global identity and community-history platform** for Discord users. AZRA builds one centralized profile per user it encounters, aggregating **authorized** information from participating servers while keeping global, server-specific, and moderator-only information strictly separated.

> **Status:** backend foundation **+ Discord bot integration**. Profile image rendering may be added on top later; every profile feature builds on this layer.

---

## Core concept

```
Discord Event
   → AZRA Event Processor          (src/events/processor.js)
      → Validation                  (validators.js — shapes, snowflakes, enums)
      → Permission/Data-Sharing     (permissionGate.js — guild opt-in, category,
       Check                        per-user opt-out, source status, visibility)
      → Global Database             (global_* tables — cross-server aggregates)
      → Server Database             (guild_* tables — guild-local truth)
      → Aggregation                 (aggregation_queue → background worker)
      → Cache                       (TTL cache, invalidated per user/guild)
```

**The cross-server rule is enforced in code, not convention:** global aggregates are recomputed *only* from guilds that are registered, participating, and have explicitly allowed the event's data category. One server's data never silently becomes global truth.

## The data rule — never present incomplete data as zero

Every summary carries **coverage metadata** and humanized lines:

| Situation | Displayed |
|---|---|
| 0 bans, partial coverage | `No recorded bans in available AZRA data.` |
| 3 bans, 2 of 20 communities contributing | `3 bans recorded. Limited data — 2 of 20 participating communities.` |
| no data at all | `No AZRA data yet — 2 participating communities available.` |
| unknown / not collected | `Unknown — not enough AZRA data for bans.` |

Unknown values are stored as `null` — never as `0`. See `src/services/coverage.js` (`buildCoverage`, `humanizeMetric`, `describeMetric`, `coverageNote`).

## Data separation

| Layer | Tables | Visibility |
|---|---|---|
| **Global** | `global_users`, `global_verification`, `global_badges`, `global_achievements`, `global_activity`(+`_daily`), `global_reputation`, `global_restrictions`, `global_timeline` | `PUBLIC` viewers see `GLOBAL` entries only |
| **Guild** | `guild_user_profiles`, `guild_user_moderation`, `guild_user_activity`, `guild_user_roles`, `guild_user_verification` | guild-scoped; moderation reasons never leave this layer unless the guild allows `MODERATION` |
| **Private / moderator-only** | `MODERATOR_ONLY` timeline entries, reputation scores, restrictions, `profile_access_logs` | `MODERATOR`/`ADMIN` viewer scopes only |

Every accepted event is traceable via **`profile_data_sources`** (guild, source type, event id, visibility, authorization status) — AZRA can always explain where a piece of information came from.

## Storage: JSON now, MySQL later

The current driver is a **JSON file store** (`AZRA_DATA_DIR`, one file per table, atomic `tmp + rename` writes, `.bak` recovery, debounced flush, journaled transactions with rollback). It mirrors the production schema table-for-table.

The **production MySQL 8 schema is already authored**: [`src/migrations/001_global_profile_schema.sql`](src/migrations/001_global_profile_schema.sql) — 20 tables, InnoDB, `utf8mb4`, composite indexes, keyset-pagination columns. Swapping to MySQL means implementing the same model API against `mysql2` (pooling, prepared statements, `supportBigNumbers + bigNumberStrings` for snowflakes); the event pipeline, services, and tests stay unchanged.

## Getting started

```bash
npm install
npm run seed             # resets ./data and seeds demo communities through the real pipeline
npm test                 # 80+ tests — store, pipeline, idempotency, coverage, aggregation, schema, Discord mappers, generators
```

Seed output demonstrates the coverage language, permission gating (a non-participating guild's events are skipped), and moderator vs public views of the same profile.

## Discord integration (`bot/`)

The bot layer connects the Discord gateway to the event pipeline — nothing here touches the database directly; everything flows through `ingestEvent()`.

### Setup

1. Create an application at the [Discord Developer Portal](https://discord.com/developers/applications) → add a **Bot** user.
2. Enable **Privileged Gateway Intents**: *Server Members* and *Message Content*.
3. Invite the bot with the `bot` scope (permissions: View Channels, View Members, Manage Messages not required).
4. Fill `.env` (see `.env.example`): `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, optional `DISCORD_GUILD_ID` (dev-guild instant command registration), `AZRA_DEFAULT_SHARING_LEVEL` (privacy-first default: `NONE`).
5. Run:

```bash
npm run deploy:commands   # registers slash commands (instant for DISCORD_GUILD_ID)
npm run bot               # connects to the gateway
```

### Slash commands

| Command | Who | What |
|---|---|---|
| `/generate-data [user] [days] [intensity]` | Manage Server | The **single data-entry command**. Auto-registers this server with AZRA (sharing `FULL`) if needed, then generates random demo data — activity over the past N days (default 14), verification, a badge, and (normal/heavy) a warning — through the real pipeline. Recalculates aggregates immediately. |
| `/profile [user]` | everyone | Global profile embed from the stored data — coverage note, activity (never-fake-zero lines), verification, badges, reputation level, recent history. Moderators additionally see reputation score, scoped moderation lines, and active global restrictions. |

### Gateway → pipeline event mapping

| Discord event | AZRA event |
|---|---|
| `ClientReady` / `GuildCreate` | `GUILD_REGISTER` (first sighting, env default level) or `GUILD_UPDATE` touch (preserving admin settings) |
| `GuildDelete` | `GUILD_UPDATE` → status `REMOVED`, participation off |
| `GuildMemberAdd` / `GuildMemberRemove` | `MEMBER_JOINED` / `MEMBER_LEFT` (+ identity upsert) |
| `GuildMemberUpdate` | `ROLE_ADDED`/`ROLE_REMOVED` (role diff), `USER_UPSERT` (nickname), `MODERATION_ACTION TIMEOUT` (fresh timeout with expiry) |
| `MessageCreate` / `MessageReactionAdd` | `ACTIVITY_MESSAGE` / `ACTIVITY_REACTION` (content never stored — only the fact) |
| `GuildBanAdd` / `GuildBanRemove` | `MODERATION_ACTION BAN` / `UNBAN` (membership cannot regress `BANNED → LEFT` from the ban+leave race) |
| `VoiceStateUpdate` | `ACTIVITY_VOICE` minutes via a join/leave tracker (min 1 minute) |
| `InteractionCreate` | `ACTIVITY_COMMAND` |

All event ids are **deterministic** (`djs:msg:<id>`, `djs:memberjoin:<guild>:<user>:<ts>` …) so duplicate gateway deliveries and bot restarts cannot double-count. Ingestion failures never crash the gateway — they are logged and ledgered.

### Testing on Discord

The bot exposes exactly **two** commands: `/generate-data` and `/profile`.

1. Invite the bot, then run `/generate-data user:@you days:14 intensity:normal`.
   - If this server isn't registered with AZRA or isn't sharing yet, **`/generate-data` auto-registers/switches the server to `FULL` sharing** as part of the run, so data is guaranteed to flow.
2. Data lands in `data/*.json` (~250 ms flush): `global_activity.json`, `guild_user_activity.json`, `global_activity_daily.json`, `global_badges.json`, `global_verification.json`, `global_timeline.json`, `global_reputation.json`, plus `profile_data_sources.json` (provenance of every event).
3. Run `/profile` to see the profile embed rendered from that data.

*(Optional env control: set `AZRA_DEFAULT_SHARING_LEVEL=FULL` in `.env` before the first bot invite so new servers start participating and `/generate-data` skips its auto-opt-in step.)*

Without a live Discord, `npm run seed` does the same end-to-end (registers participating guilds + users + activity and prints sample profiles).

## Event types & gating

`GUILD_REGISTER/UPDATE`, `USER_UPSERT`, `MEMBER_JOINED/LEFT`, `ACTIVITY_MESSAGE/VOICE/REACTION/COMMAND`, `ROLE_ADDED/REMOVED`, `VERIFICATION_COMPLETED/FAILED`, `MODERATION_ACTION`, `BADGE_AWARDED/REVOKED`, `ACHIEVEMENT_UNLOCKED`, `REPUTATION_SIGNAL`, `RESTRICTION_APPLIED/LIFTED`.

The permission gate (default-deny) skips an event — recording the reason in `processed_events` — when: the guild is unregistered / not participating / paused, the guild's `profile_data_permissions` row for the event's category is missing or disallowed, the user opted out (`data_sharing_enabled = false`), or the source is blocked. Guild registration seeds permissions from its `data_sharing_level` (`NONE / MINIMAL / STANDARD / FULL`). Platform restrictions require the `GLOBAL_ADMIN` source type.

**Idempotency:** every event claims a slot in the `processed_events` ledger by unique `event_id` before any write; replays return `{ status: 'duplicate' }` and mutate nothing. Failures are recorded with attempt counts and a retryable status.

## Aggregation

Handlers enqueue jobs (`RECALC_CONTRIBUTING_GUILDS`, `RECALC_REPUTATION`, `RECALC_GLOBAL_VERIFICATION`, `REBUILD_GUILD_AGGREGATES`) with de-duplication; a background worker claims batches in `(priority, id)` order — the JSON equivalent of `FOR UPDATE SKIP LOCKED` — with exponential backoff and stuck-job recovery. All aggregates are computed only from authorized sources.

## Performance contract

- Aggregated counters instead of history scans; daily buckets for time series.
- Keyset pagination on every list API (`{ items, nextCursor, total }`).
- Composite indexes in the SQL schema for every hot path (`idx_gum_guild_user`, `idx_gt_user_time`, `idx_aq_poll`, …).
- Background processing for aggregation; summaries never load full histories.
- **No `SELECT *` anywhere** — enforced by a test.
- Connection pooling applies at the MySQL swap (`DB_CONNECTION_LIMIT`).

## Known limitations / next steps

- The JSON driver is for development scale (in-memory state, single process). The MySQL swap is the production path.
- `GLOBAL_ADMIN` source authenticity (who may fire restriction events) belongs to the bot's auth layer.
- Cache is in-process; swap for Redis at horizontal scale.
- Add a scheduled retention job for `profile_access_logs` (`purgeOlderThan` is ready).

