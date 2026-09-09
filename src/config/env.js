import path from 'node:path';
import dotenv from 'dotenv';
import { GUILD_DATA_SHARING_LEVELS } from '../domain/catalog.js';

dotenv.config();

function strEnv(name, fallback) {
  const raw = process.env[name];
  return raw == null || raw === '' ? fallback : raw;
}

function intEnv(name, fallback) {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value)) {
    throw new Error(`Invalid environment value for ${name}: "${raw}" is not an integer`);
  }
  return value;
}

const DRIVER = strEnv('AZRA_DB_DRIVER', 'json');
if (!['json', 'mysql'].includes(DRIVER)) {
  throw new Error(`Unsupported AZRA_DB_DRIVER "${DRIVER}" (expected "json" or "mysql")`);
}

export const env = {
  driver: DRIVER,
  dataDir: path.resolve(strEnv('AZRA_DATA_DIR', './data')),
  flushDebounceMs: intEnv('AZRA_FLUSH_DEBOUNCE_MS', 250),
  logLevel: strEnv('AZRA_LOG_LEVEL', 'info'),
  cache: {
    ttlMs: intEnv('AZRA_CACHE_TTL_MS', 30_000),
    maxKeys: intEnv('AZRA_CACHE_MAX_KEYS', 5_000),
  },
  aggregation: {
    pollIntervalMs: intEnv('AZRA_AGGREGATION_POLL_MS', 2_000),
    batchSize: intEnv('AZRA_AGGREGATION_BATCH', 50),
    maxAttempts: intEnv('AZRA_AGGREGATION_MAX_ATTEMPTS', 5),
  },
  events: {
    maxAttempts: intEnv('AZRA_EVENTS_MAX_ATTEMPTS', 3),
    maxFutureSkewMs: 5 * 60_000,
  },
  mysql: {
    host: strEnv('DB_HOST', '127.0.0.1'),
    port: intEnv('DB_PORT', 3306),
    database: strEnv('DB_NAME', 'azra_profiles'),
    user: strEnv('DB_USER', 'azra'),
    password: strEnv('DB_PASSWORD', ''),
    connectionLimit: intEnv('DB_CONNECTION_LIMIT', 20),
  },
  discord: {
    token: strEnv('DISCORD_TOKEN', ''),
    clientId: strEnv('DISCORD_CLIENT_ID', ''),
    devGuildId: strEnv('DISCORD_GUILD_ID', ''),
    defaultSharingLevel: strEnv('AZRA_DEFAULT_SHARING_LEVEL', 'NONE'),
  },
};

if (!GUILD_DATA_SHARING_LEVELS.includes(env.discord.defaultSharingLevel)) {
  throw new Error(
    `Invalid AZRA_DEFAULT_SHARING_LEVEL "${env.discord.defaultSharingLevel}" ` +
      `(expected one of: ${GUILD_DATA_SHARING_LEVELS.join(', ')})`,
  );
}
