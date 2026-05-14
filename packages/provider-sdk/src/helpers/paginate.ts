import type { Page } from '../models/page.js';

/**
 * Adapt any envelope-returning list method into an `AsyncIterable<T>` that
 * walks every page. Pure, stateless, adapter-agnostic.
 *
 * ```ts
 * import { paginate } from '@its-just-billing/provider-sdk';
 *
 * for await (const product of paginate(
 *   (cursor) => provider.products.list({ cursor, active: true }),
 * )) {
 *   await process(product);
 *   if (gotEnough) break; // generator returns, no more HTTP
 * }
 * ```
 *
 * The closure is the only friction: it makes the bound filters explicit and
 * sidesteps `this`-binding issues that come with passing a bare method.
 *
 * The helper does not manage retries, backoff, or persistence — callers that
 * need any of those should consume the envelope directly.
 */
export async function* paginate<T>(
  fetchPage: (cursor: string | undefined) => Promise<Page<T>>,
): AsyncIterable<T> {
  let cursor: string | undefined;
  do {
    const page = await fetchPage(cursor);
    for (const item of page.data) yield item;
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
}
