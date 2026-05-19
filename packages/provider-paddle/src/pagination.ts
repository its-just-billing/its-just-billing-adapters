/**
 * Translate a Paddle SDK `Collection` into the normalized `Page` envelope.
 *
 * Paddle collections are async-iterable with a `next()` that returns the
 * current page and a `hasMore` flag; the list endpoints take an opaque
 * `after` cursor (an entity id). The normalized cursor is opaque to callers,
 * so when more pages remain we hand back the last item's id — the next
 * `list({ cursor })` call passes it straight through as Paddle's `after`.
 *
 * `next()` is called exactly once: the SDK contract pages one request at a
 * time, never auto-draining the collection.
 */
export async function pageFromPaddleCollection<TEntity extends { id: string }, TNormalized>(
  collection: { next(): Promise<TEntity[]>; hasMore: boolean },
  normalize: (item: TEntity) => TNormalized,
): Promise<{ data: TNormalized[]; nextCursor: string | null }> {
  const page = await collection.next();
  const data = page.map(normalize);
  const last = page[page.length - 1];
  const nextCursor = collection.hasMore && last ? last.id : null;
  return { data, nextCursor };
}
