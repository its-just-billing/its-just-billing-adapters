import type { Metadata } from '@its-just-billing/provider-sdk';
import type Stripe from 'stripe';

/**
 * Translate a caller's "replacement" metadata into Stripe's merge-semantics
 * shape. Stripe metadata writes merge keys instead of replacing the whole
 * map; to delete a key you must send it with an empty-string value. To match
 * the SDK contract (update.metadata fully replaces user-visible metadata),
 * we diff against the current state and synthesize the deletes.
 *
 * Reserved adapter-managed keys (`__provider_*`) are NEVER touched by this
 * helper — those are the adapter's own bookkeeping (quantity bounds, etc.)
 * and survive caller-driven metadata replacements untouched. Callers can't
 * write reserved keys (assertNoReservedKeys rejects them at input).
 *
 * Returns a `MetadataParam` ready to pass directly to Stripe's update calls.
 */
export function diffMetadataForReplace(
  newMetadata: Metadata,
  currentNative: Stripe.Metadata | null | undefined,
): Stripe.MetadataParam {
  const result: Stripe.MetadataParam = {};
  for (const [k, v] of Object.entries(newMetadata)) result[k] = v;
  if (currentNative) {
    for (const key of Object.keys(currentNative)) {
      if (key.startsWith('__provider_')) continue;
      if (!(key in newMetadata)) {
        // Empty string is Stripe's "delete this key" sentinel.
        result[key] = '';
      }
    }
  }
  return result;
}
