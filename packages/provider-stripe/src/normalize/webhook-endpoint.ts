import {
  type ProviderEventType,
  ProviderNormalizationError,
  type ProviderWebhookEndpoint,
} from '@its-just-billing/provider-sdk';
import type Stripe from 'stripe';
import { fromUnixSeconds } from '../clone-date.js';
import { NORMALIZED_TO_STRIPE_EVENT, STRIPE_TO_NORMALIZED_EVENT } from './event.js';

/**
 * Map an array of Stripe event-type strings (as stored on a WebhookEndpoint's
 * `enabled_events`) into the normalized SDK event-type enum. Stripe-only types
 * are dropped silently — the round-trip is "best effort" since not every
 * Stripe event has an SDK equivalent.
 *
 * The wildcard `'*'` expands to every normalized type the SDK knows about.
 */
function stripeEventsToNormalized(enabled: string[]): ProviderEventType[] {
  if (enabled.includes('*')) {
    return Array.from(new Set(Object.values(STRIPE_TO_NORMALIZED_EVENT)));
  }
  const set = new Set<ProviderEventType>();
  for (const e of enabled) {
    const mapped = STRIPE_TO_NORMALIZED_EVENT[e];
    if (mapped) set.add(mapped);
  }
  return Array.from(set);
}

/**
 * Inverse — translate a normalized eventTypes array into the Stripe-native
 * event names needed for `enabled_events`. Each normalized type expands to
 * every Stripe alias that maps to it (e.g. `discount.created` expands to
 * `coupon.created` + `promotion_code.created`).
 */
export function normalizedEventsToStripe(types: ProviderEventType[]): string[] {
  const set = new Set<string>();
  for (const t of types) {
    const aliases = NORMALIZED_TO_STRIPE_EVENT[t];
    if (aliases) for (const a of aliases) set.add(a);
  }
  if (set.size === 0) {
    throw new ProviderNormalizationError({
      message:
        'None of the requested eventTypes have a Stripe equivalent. Stripe requires at least one enabled_events entry.',
    });
  }
  return Array.from(set);
}

export function normalizeStripeWebhookEndpoint(
  native: Stripe.WebhookEndpoint,
): ProviderWebhookEndpoint<Stripe.WebhookEndpoint> {
  return {
    id: native.id,
    url: native.url,
    eventTypes: stripeEventsToNormalized(native.enabled_events),
    active: native.status === 'enabled',
    createdAt: fromUnixSeconds(native.created),
    raw: native,
  };
}
