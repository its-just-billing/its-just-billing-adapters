import {
  type CheckoutLineItem,
  type CheckoutSessionStatus,
  type ProviderCheckoutSession,
  ProviderNormalizationError,
  stripReservedKeys,
} from '@its-just-billing/provider-sdk';
import type Stripe from 'stripe';
import { fromUnixSeconds } from '../clone-date.js';
import type { StripeCheckoutPresentation } from '../presentation.js';

function statusOf(s: Stripe.Checkout.Session): CheckoutSessionStatus {
  // Stripe surfaces `Session.Status | null`. The null variant occurs for
  // legacy sessions; treat as 'open' rather than throwing — the conformance
  // tests expect a deterministic mapping.
  if (s.status === 'complete') return 'complete';
  if (s.status === 'expired') return 'expired';
  return 'open';
}

function presentationOf(s: Stripe.Checkout.Session): StripeCheckoutPresentation {
  if (s.ui_mode === 'embedded') {
    if (!s.client_secret) {
      throw new ProviderNormalizationError({
        message: `Stripe embedded checkout session ${s.id} has no client_secret`,
      });
    }
    return { kind: 'stripe_embedded', clientSecret: s.client_secret };
  }
  // Default to hosted. `url` is null after a session is complete/expired —
  // synthesize a placeholder so the presentation field stays well-formed.
  return { kind: 'stripe_hosted', url: s.url ?? '' };
}

function customerIdOf(s: Stripe.Checkout.Session): string | null {
  if (typeof s.customer === 'string') return s.customer;
  if (s.customer && typeof s.customer === 'object') return s.customer.id;
  return null;
}

/**
 * Translate a `Stripe.LineItem` (as returned by
 * `stripe.checkout.sessions.listLineItems` or by `expand: ['line_items']`)
 * into the SDK's normalized `CheckoutLineItem` shape.
 */
export function stripeLineItemToCheckoutLineItem(item: Stripe.LineItem): CheckoutLineItem {
  const priceId = typeof item.price === 'string' ? item.price : (item.price?.id ?? null);
  if (!priceId) {
    throw new ProviderNormalizationError({
      message: `Stripe checkout line item ${item.id} has no price reference`,
    });
  }
  return { priceId, quantity: item.quantity ?? 1 };
}

/**
 * Normalize a Stripe Checkout Session into the SDK shape.
 *
 * `lineItems` is the COMPLETE list — callers are responsible for paging
 * through `stripe.checkout.sessions.listLineItems` on the read path
 * (Stripe's inline `expand: ['line_items']` only ever embeds the first
 * page) or for passing through the caller-supplied input on the create path.
 * The normalizer does NOT inspect `native.line_items`, so this method can't
 * silently truncate a session with a large cart.
 */
export function normalizeStripeCheckoutSession(
  native: Stripe.Checkout.Session,
  lineItems: CheckoutLineItem[],
): ProviderCheckoutSession<StripeCheckoutPresentation, Stripe.Checkout.Session> {
  if (lineItems.length === 0) {
    throw new ProviderNormalizationError({
      message: `Stripe checkout session ${native.id} has no line items`,
    });
  }
  if (!native.success_url) {
    throw new ProviderNormalizationError({
      message: `Stripe checkout session ${native.id} has no success_url`,
    });
  }

  return {
    id: native.id,
    status: statusOf(native),
    customerId: customerIdOf(native),
    lineItems: lineItems.map((li) => ({ priceId: li.priceId, quantity: li.quantity })),
    successUrl: native.success_url,
    cancelUrl: native.cancel_url ?? null,
    metadata: stripReservedKeys(native.metadata ?? {}),
    expiresAt: native.expires_at !== undefined ? fromUnixSeconds(native.expires_at) : null,
    createdAt: fromUnixSeconds(native.created),
    presentation: presentationOf(native),
    raw: native,
  };
}
