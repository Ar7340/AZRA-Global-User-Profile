import { ValidationError } from './errors.js';

// Discord epoch: 2015-01-01T00:00:00.000Z
const DISCORD_EPOCH = 1420070400000n;

/**
 * Validates a Discord snowflake. Snowflakes are 64-bit unsigned integers,
 * currently rendered as 16–20 digit strings. They MUST be handled as strings
 * in JavaScript (Numbers lose precision above 2^53).
 */
export function isValidSnowflake(value) {
  if (typeof value !== 'string') return false;
  if (!/^\d{16,20}$/.test(value)) return false;
  const n = BigInt(value);
  return n > 0n && n < 1n << 64n;
}

/** Validates and returns the snowflake, or throws ValidationError. */
export function assertSnowflake(value, field = 'id') {
  if (!isValidSnowflake(value)) {
    throw new ValidationError(`Invalid Discord snowflake for "${field}"`, {
      details: { field, received: typeof value === 'string' ? value : typeof value },
    });
  }
  return value;
}

/** Returns the snowflake if valid, null if value is null/undefined, throws otherwise. */
export function optionalSnowflake(value, field = 'id') {
  if (value == null) return null;
  return assertSnowflake(String(value), field);
}

/** Derives the account creation timestamp from a snowflake. */
export function snowflakeToDate(value) {
  if (!isValidSnowflake(value)) return null;
  return new Date(Number((BigInt(value) >> 22n) + DISCORD_EPOCH));
}

export function snowflakeToIso(value) {
  const date = snowflakeToDate(value);
  return date ? date.toISOString() : null;
}
