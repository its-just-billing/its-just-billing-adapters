/**
 * Translate a Stripe paginated response into the normalized `Page` envelope.
 * Stripe uses cursor pagination with `starting_after` + `has_more`; the
 * normalized cursor is opaque to callers so we use the last item's id as the
 * cursor token when more pages remain.
 */
export function pageFromStripeList<TNative extends { id: string }, TNormalized>(
  native: { data: TNative[]; has_more: boolean },
  normalize: (item: TNative) => TNormalized,
): { data: TNormalized[]; nextCursor: string | null } {
  const data = native.data.map(normalize);
  const last = native.data[native.data.length - 1];
  const nextCursor = native.has_more && last ? last.id : null;
  return { data, nextCursor };
}
