import { ValidationError } from './errors.js';

export function nowIso() {
  return new Date().toISOString();
}

/** Converts any date-ish value to an ISO-8601 UTC string; throws on invalid input. */
export function toIso(value) {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new ValidationError(`Invalid date value: ${String(value)}`);
  }
  return date.toISOString();
}

export function toIsoOrNull(value) {
  try {
    return toIso(value);
  } catch {
    return null;
  }
}

// ISO-8601 UTC strings share a fixed format, so lexicographic comparison
// is equivalent to chronological comparison.
export function maxIso(a, b) {
  if (a == null) return b;
  if (b == null) return a;
  return a >= b ? a : b;
}

export function minIso(a, b) {
  if (a == null) return b;
  if (b == null) return a;
  return a <= b ? a : b;
}

/** '2026-09-09T12:34:56.789Z' → '2026-09-09' */
export function dateOnly(iso) {
  return typeof iso === 'string' && iso.length >= 10 ? iso.slice(0, 10) : null;
}

export function addMinutesIso(iso, minutes) {
  return new Date(Date.parse(iso) + minutes * 60_000).toISOString();
}

export function isBeforeOrEqual(a, b) {
  return a != null && b != null && a <= b;
}
