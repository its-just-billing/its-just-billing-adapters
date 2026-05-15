import {
  type PriceKind,
  ProviderNormalizationError,
  type ProviderPrice,
  decodeQuantityFromMetadata,
  normalizeCurrency,
  stripReservedKeys,
} from '@its-just-billing/provider-sdk';
import type Stripe from 'stripe';
import { fromUnixSeconds } from '../clone-date.js';

function productIdOf(p: Stripe.Price): string {
  if (typeof p.product === 'string') return p.product;
  if (p.product && typeof p.product === 'object') return p.product.id;
  throw new ProviderNormalizationError({
    message: `Stripe price ${p.id} has no product reference`,
  });
}

export function normalizeStripePrice(native: Stripe.Price): ProviderPrice<Stripe.Price> {
  if (native.unit_amount === null) {
    // Tiered or custom-unit-amount prices have no flat unit_amount. The SDK's
    // normalized price model only models per_unit; reject these explicitly
    // rather than silently returning 0.
    throw new ProviderNormalizationError({
      message: `Stripe price ${native.id} has no unit_amount (tiered or custom unit pricing is not normalized)`,
    });
  }
  const recurring = native.recurring;
  const kind: PriceKind = recurring ? 'recurring' : 'one_time';
  const quantity = decodeQuantityFromMetadata(native.metadata ?? {}, kind);
  const base = {
    id: native.id,
    productId: productIdOf(native),
    active: native.active,
    currency: normalizeCurrency(native.currency),
    quantity,
    metadata: stripReservedKeys(native.metadata ?? {}),
    createdAt: fromUnixSeconds(native.created),
    // Stripe's Price model has no explicit `updated` field — created is the
    // best signal we have for SDK-managed prices. (Stripe prices are mostly
    // immutable; metadata writes don't surface a separate timestamp.)
    updatedAt: fromUnixSeconds(native.created),
    raw: native,
  };
  if (!recurring) {
    return { ...base, kind: 'one_time', unitAmount: native.unit_amount };
  }
  return {
    ...base,
    kind: 'recurring',
    unitAmount: native.unit_amount,
    interval: recurring.interval,
    intervalCount: recurring.interval_count,
  };
}
