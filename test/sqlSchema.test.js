import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SQL_PATH = path.join(ROOT, 'src', 'migrations', '001_global_profile_schema.sql');

const REQUIRED_TABLES = [
  'global_users',
  'global_verification',
  'global_badges',
  'global_achievements',
  'global_activity',
  'global_reputation',
  'global_restrictions',
  'global_timeline',
  'guild_user_profiles',
  'guild_user_moderation',
  'guild_user_activity',
  'guild_user_roles',
  'guild_user_verification',
  'profile_data_permissions',
  'profile_data_sources',
  'profile_access_logs',
  // architecture additions
  'guilds',
  'processed_events',
  'global_activity_daily',
  'aggregation_queue',
];

const REQUIRED_INDEXES = [
  'idx_gup_guild_seen',
  'idx_gum_guild_user',
  'idx_gt_user_time',
  'idx_aq_poll',
  'idx_pdp_allowed',
  'idx_pe_status_time',
  'idx_gua_user',
  'idx_pal_target',
];

function readSql() {
  return fs.readFileSync(SQL_PATH, 'utf8');
}

test('SQL schema defines every required table', () => {
  const sql = readSql();
  const defined = new Set(
    [...sql.matchAll(/CREATE TABLE IF NOT EXISTS `(\w+)`/g)].map((m) => m[1]),
  );
  const missing = REQUIRED_TABLES.filter((t) => !defined.has(t));
  assert.deepEqual(missing, [], `missing tables: ${missing.join(', ')}`);
  assert.equal(defined.size, REQUIRED_TABLES.length, 'no stray tables expected');
});

test('SQL schema declares the critical composite indexes', () => {
  const sql = readSql();
  const missing = REQUIRED_INDEXES.filter((idx) => !sql.includes(`\`${idx}\``));
  assert.deepEqual(missing, [], `missing indexes: ${missing.join(', ')}`);
});

test('SQL schema targets MySQL 8 semantics', () => {
  const sql = readSql();
  assert.ok(sql.includes('ENGINE=InnoDB'), 'InnoDB required');
  assert.ok(sql.includes('utf8mb4_0900_ai_ci'), 'utf8mb4 0900 collation required');
  assert.ok(sql.includes('BIGINT UNSIGNED'), 'snowflakes stored as BIGINT UNSIGNED');
  assert.ok(sql.includes('`occurred_at` DESC'), 'descending index columns present');
});

test('source code never uses SELECT *', () => {
  const srcDir = path.join(ROOT, 'src');
  const offenders = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.js')) {
        const content = fs.readFileSync(full, 'utf8');
        if (/SELECT\s+\*/i.test(content)) offenders.push(path.relative(ROOT, full));
      }
    }
  };
  walk(srcDir);
  assert.deepEqual(offenders, [], 'SELECT * is forbidden by the performance contract');
});

test('every requested logical table exists as a JSON model table', async () => {
  const { TABLE_NAMES } = await import('../src/db/json/schema.js');
  const names = Object.values(TABLE_NAMES);
  const missing = REQUIRED_TABLES.filter((t) => !names.includes(t));
  assert.deepEqual(missing, []);
});
