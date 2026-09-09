/**
 * Keyset pagination helpers for the JSON driver (MySQL swap uses the same
 * cursor semantics with indexed ORDER BY ... DESC queries).
 *
 * Sort keys are built from fixed-width padded components so lexicographic
 * string comparison matches the intended (desc) ordering of composite keys.
 */
export function sortKey(...parts) {
  return parts.map((p) => String(p ?? '').padStart(40, '0')).join('|');
}

/**
 * Sorts rows descending by keyOf, optionally resuming after a cursor
 * (either a row object or a precomputed key string).
 * Returns { items, nextCursor, total } — total is the pre-pagination count.
 */
export function paginateDesc(rows, { keyOf, limit = 25, before = null } = {}) {
  const sorted = [...rows].sort((a, b) => keyOf(b).localeCompare(keyOf(a)));
  let start = 0;
  if (before != null) {
    const cursorKey = typeof before === 'string' ? before : keyOf(before);
    const idx = sorted.findIndex((r) => keyOf(r).localeCompare(cursorKey) < 0);
    start = idx === -1 ? sorted.length : idx;
  }
  const items = sorted.slice(start, start + limit);
  const hasMore = start + limit < sorted.length;
  return {
    items,
    nextCursor: hasMore && items.length > 0 ? keyOf(items[items.length - 1]) : null,
    total: sorted.length,
  };
}
