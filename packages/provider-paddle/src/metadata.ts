import { type Metadata, stripReservedKeys } from '@its-just-billing/provider-sdk';

/**
 * Adapter-managed `customData` keys (all under the SDK's reserved
 * `__provider_*` namespace, so `stripReservedKeys` hides them from
 * caller-visible metadata and `assertNoReservedKeys` blocks callers from
 * setting them). Used to round-trip values the provider can't persist
 * faithfully and the adapter must not fake into a functional field: a
 * discount `restrictedTo` whose ids Paddle would existence-validate (gated
 * by the discount-restriction capability flags being `false`), and the
 * checkout success/cancel URLs Paddle doesn't store. The discount `code` is
 * deliberately NOT here — it must redeem at Paddle, so it is sent natively.
 */
export const PADDLE_RESERVED = {
  DISCOUNT_RESTRICT: '__provider_discount_restrict',
  // Paddle transactions don't persist a caller-supplied success/cancel URL
  // (they're checkout-settings concerns, not transaction fields), so the
  // checkout session round-trips them through managed `customData`.
  CHECKOUT_SUCCESS_URL: '__provider_checkout_success_url',
  CHECKOUT_CANCEL_URL: '__provider_checkout_cancel_url',
} as const;

/**
 * Pull the adapter's `__provider_*` keys out of a native `customData`. Paddle
 * replaces `customData` wholesale on update, so a metadata-only update must
 * re-send these or the managed state (e.g. a discount's code) is lost.
 */
export function preservedReservedKeys(
  customData: Record<string, unknown> | null | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!customData) return out;
  for (const [k, v] of Object.entries(customData)) {
    if (k.startsWith('__provider_')) out[k] = typeof v === 'string' ? v : JSON.stringify(v);
  }
  return out;
}

/**
 * Paddle's `customData` is an arbitrary JSON object; the SDK's `Metadata` is
 * a flat `Record<string,string>`. The adapter only ever writes string values
 * into `customData` (it's the SDK metadata verbatim), but a record created in
 * the Paddle dashboard could carry nested/non-string values — coerce
 * defensively on read so the normalized shape always satisfies the schema,
 * and drop the reserved `__provider_*` namespace from caller-visible output.
 */
export function paddleCustomDataToMetadata(
  customData: Record<string, unknown> | null | undefined,
): Metadata {
  if (!customData) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(customData)) {
    out[k] = typeof v === 'string' ? v : JSON.stringify(v);
  }
  return stripReservedKeys(out);
}
