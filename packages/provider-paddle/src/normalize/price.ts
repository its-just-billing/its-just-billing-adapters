import {
  type PriceKind,
  ProviderNormalizationError,
  type ProviderPrice,
  normalizeCurrency,
} from '@its-just-billing/provider-sdk';
import type { Price } from '@paddle/paddle-node-sdk';
import { paddleCustomDataToMetadata } from '../metadata.js';

/**
 * Paddle requires a concrete `quantity.maximum`, but the SDK models an
 * unbounded upper bound as an *absent* `max` (`defaultQuantityFor('one_time')`
 * is `{ min: 1 }`). The adapter writes this sentinel for "unbounded" (see
 * `domains/prices.ts`); on read a maximum at/above it normalizes back to "no
 * max" so the round-trip is faithful.
 */
export const PADDLE_UNBOUNDED_QUANTITY_MAX = 999_999;

/**
 * Paddle price → normalized ProviderPrice.
 *
 * Recurrence is discriminated by `price.billingCycle`: `null` ⇒ a one-time
 * price; present ⇒ recurring, with `interval`/`intervalCount` taken from the
 * billing cycle's `{ interval, frequency }`.
 *
 * Money: Paddle `unitPrice.amount` is already in minor units as a string;
 * the SDK `Money` wants an integer minor-unit `amount` and a lowercased
 * ISO-4217 `currency` (via `normalizeCurrency`).
 *
 * Quantity is first-class on a Paddle price (`quantity.{minimum,maximum}`),
 * enforced natively at checkout / subscription change — unlike Stripe, the
 * adapter relies on it directly rather than encoding it into reserved
 * metadata. It maps to the SDK's `{ min, max }`, except a `maximum` at/above
 * {@link PADDLE_UNBOUNDED_QUANTITY_MAX} is the adapter's "unbounded" sentinel
 * and normalizes to an absent `max`.
 *
 * `active` is derived from Paddle's two-state `status`.
 */
export function normalizePaddlePrice(native: Price): ProviderPrice<Price> {
  const rawAmount = native.unitPrice.amount;
  const unitAmount = Number.parseInt(rawAmount, 10);
  if (!Number.isFinite(unitAmount)) {
    // Paddle should always return a numeric minor-unit string; a non-numeric
    // value means an unmappable price shape (e.g. a custom/non-catalog price
    // surfaced unexpectedly) — reject rather than silently coercing to 0.
    throw new ProviderNormalizationError({
      message: `Paddle price ${native.id} has a non-numeric unit amount (${rawAmount})`,
    });
  }
  const cycle = native.billingCycle;
  const kind: PriceKind = cycle ? 'recurring' : 'one_time';
  const quantity =
    native.quantity.maximum >= PADDLE_UNBOUNDED_QUANTITY_MAX
      ? { min: native.quantity.minimum }
      : { min: native.quantity.minimum, max: native.quantity.maximum };
  const base = {
    id: native.id,
    productId: native.productId,
    active: native.status === 'active',
    currency: normalizeCurrency(native.unitPrice.currencyCode),
    quantity,
    metadata: paddleCustomDataToMetadata(native.customData),
    createdAt: new Date(native.createdAt),
    updatedAt: new Date(native.updatedAt),
    raw: native,
  };
  if (!cycle) {
    return { ...base, kind: 'one_time', unitAmount };
  }
  return {
    ...base,
    kind: 'recurring',
    unitAmount,
    interval: cycle.interval,
    intervalCount: cycle.frequency,
  };
}
