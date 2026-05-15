import type {
  EventResourceKind,
  ProviderEvent,
  ProviderEventType,
} from '@its-just-billing/provider-sdk';
import type Stripe from 'stripe';
import { fromUnixSeconds } from '../clone-date.js';

/**
 * Stripe event type → normalized ProviderEventType. Stripe types not mapped
 * here are silently dropped from the SDK's event surface; the contract only
 * exposes events whose type is in `ProviderEventType`.
 *
 * For discounts we map ONLY promotion-code events, never coupon events. The
 * adapter's discounts domain identifies a discount by its PromotionCode id
 * (`promo_...`); `coupon.*` events carry a coupon id (`coupon_...`) which
 * `discounts.get` cannot resolve. The SDK event contract is "use the
 * resource id to refetch", so emitting a `discount.*` event with a coupon
 * id breaks the contract. Dashboard-created coupons without a promotion
 * code are intentionally invisible to the SDK event stream — they are also
 * invisible to `discounts.get`, so the surface is consistent.
 */
export const STRIPE_TO_NORMALIZED_EVENT: Record<string, ProviderEventType> = {
  'customer.created': 'customer.created',
  'customer.updated': 'customer.updated',
  'customer.deleted': 'customer.deleted',
  'product.created': 'product.created',
  'product.updated': 'product.updated',
  'price.created': 'price.created',
  'price.updated': 'price.updated',
  'customer.subscription.created': 'subscription.created',
  'customer.subscription.updated': 'subscription.updated',
  'customer.subscription.deleted': 'subscription.canceled',
  'charge.succeeded': 'purchase.succeeded',
  'charge.failed': 'purchase.failed',
  'charge.refunded': 'purchase.refunded',
  'promotion_code.created': 'discount.created',
  'promotion_code.updated': 'discount.updated',
  'checkout.session.completed': 'checkout_session.completed',
  'checkout.session.expired': 'checkout_session.expired',
  'invoice.finalized': 'billing_document.finalized',
};

/**
 * Inverse map (best-effort) used to translate the SDK-level `types` filter on
 * `events.list` into the equivalent Stripe types. Several normalized types
 * map to multiple Stripe types, so the value is an array.
 */
export const NORMALIZED_TO_STRIPE_EVENT: Record<ProviderEventType, string[]> = (() => {
  const out: Partial<Record<ProviderEventType, string[]>> = {};
  for (const [stripeType, normalized] of Object.entries(STRIPE_TO_NORMALIZED_EVENT)) {
    let arr = out[normalized];
    if (!arr) {
      arr = [];
      out[normalized] = arr;
    }
    arr.push(stripeType);
  }
  return out as Record<ProviderEventType, string[]>;
})();

const RESOURCE_KIND_FOR_EVENT: Record<ProviderEventType, EventResourceKind> = {
  'customer.created': 'customer',
  'customer.updated': 'customer',
  'customer.deleted': 'customer',
  'product.created': 'product',
  'product.updated': 'product',
  'price.created': 'price',
  'price.updated': 'price',
  'subscription.created': 'subscription',
  'subscription.updated': 'subscription',
  'subscription.canceled': 'subscription',
  'purchase.created': 'purchase',
  'purchase.succeeded': 'purchase',
  'purchase.failed': 'purchase',
  'purchase.refunded': 'purchase',
  'discount.created': 'discount',
  'discount.updated': 'discount',
  'discount.archived': 'discount',
  'checkout_session.completed': 'checkout_session',
  'checkout_session.expired': 'checkout_session',
  'billing_document.finalized': 'billing_document',
};

/**
 * Map a Stripe event to the normalized event envelope. Returns `null` when
 * the Stripe type is not in {@link STRIPE_TO_NORMALIZED_EVENT}, signaling to
 * the caller to drop the event.
 */
export function maybeNormalizeStripeEvent(
  native: Stripe.Event,
): ProviderEvent<unknown, Stripe.Event> | null {
  const normalizedType = STRIPE_TO_NORMALIZED_EVENT[native.type];
  if (!normalizedType) return null;
  // event.data.object is the resource the event is about. All Stripe resource
  // objects have an `id` field; the type is too dynamic to narrow at compile
  // time without an unsafe cast, so we read it positionally.
  const obj = native.data.object as { id?: unknown };
  const resourceId = typeof obj?.id === 'string' ? obj.id : null;
  if (!resourceId) return null;
  return {
    id: native.id,
    type: normalizedType,
    resource: { kind: RESOURCE_KIND_FOR_EVENT[normalizedType], id: resourceId },
    occurredAt: fromUnixSeconds(native.created),
    payload: native.data.object,
    raw: native,
  };
}
