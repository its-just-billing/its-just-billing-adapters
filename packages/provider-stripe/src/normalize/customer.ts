import { type ProviderCustomer, stripReservedKeys } from '@its-just-billing/provider-sdk';
import type Stripe from 'stripe';
import { fromUnixSeconds } from '../clone-date.js';

/**
 * Stripe customer → normalized ProviderCustomer. Caller-visible metadata is
 * stripped of `__provider_*` keys; `raw` retains the full native object.
 */
export function normalizeStripeCustomer(
  native: Stripe.Customer,
): ProviderCustomer<Stripe.Customer> {
  return {
    id: native.id,
    email: native.email,
    name: native.name ?? null,
    metadata: stripReservedKeys(native.metadata ?? {}),
    createdAt: fromUnixSeconds(native.created),
    raw: native,
  };
}
