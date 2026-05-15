import {
  type ProviderPurchase,
  type PurchaseStatus,
  normalizeCurrency,
  stripReservedKeys,
} from '@its-just-billing/provider-sdk';
import type Stripe from 'stripe';
import { fromUnixSeconds } from '../clone-date.js';

function customerIdOf(c: Stripe.Charge): string | null {
  if (typeof c.customer === 'string') return c.customer;
  if (c.customer && typeof c.customer === 'object') return c.customer.id;
  return null;
}

function statusOf(c: Stripe.Charge): PurchaseStatus {
  if (c.status === 'pending') return 'pending';
  if (c.status === 'failed') return 'failed';
  // succeeded:
  if (c.refunded) return 'refunded';
  if (c.amount_refunded > 0) return 'partially_refunded';
  return 'succeeded';
}

export function normalizeStripeCharge(native: Stripe.Charge): ProviderPurchase<Stripe.Charge> {
  const currency = normalizeCurrency(native.currency);
  return {
    id: native.id,
    customerId: customerIdOf(native),
    status: statusOf(native),
    amount: { amount: native.amount, currency },
    amountRefunded:
      native.amount_refunded > 0 ? { amount: native.amount_refunded, currency } : null,
    // The normalized contract surfaces priceId/productId/checkoutSessionId for
    // a one-time purchase. Stripe Charges don't reference any of those
    // directly — they reference a PaymentIntent which in turn references line
    // items only by expansion. v1 leaves them null; callers needing the link
    // can join via `raw.payment_intent`.
    priceId: null,
    productId: null,
    checkoutSessionId: null,
    metadata: stripReservedKeys(native.metadata ?? {}),
    createdAt: fromUnixSeconds(native.created),
    raw: native,
  };
}
