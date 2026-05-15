import type { Page } from '@its-just-billing/provider-sdk';

/**
 * Cursor-paginate a stable-sorted array. Cursor is the id of the last item
 * the previous page returned; the next page starts immediately after.
 * Forward-only; callers maintain history if they need back-navigation.
 */
export function paginate<T extends { id: string }>(
  rows: T[],
  cursor: string | undefined,
  limit: number | undefined,
): Page<T> {
  const size = limit ?? 100;
  let start = 0;
  if (cursor) {
    const idx = rows.findIndex((r) => r.id === cursor);
    start = idx === -1 ? rows.length : idx + 1;
  }
  const slice = rows.slice(start, start + size);
  const more = start + slice.length < rows.length;
  const last = slice[slice.length - 1];
  return { data: slice, nextCursor: more && last ? last.id : null };
}

export function sortById<T extends { id: string; createdAt: Date }>(rows: T[]): T[] {
  return rows
    .slice()
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
}
