import {
  type DiscountBenefit,
  type DiscountDuration,
  type ProviderDiscount,
  ProviderNormalizationError,
  normalizeCurrency,
} from '@its-just-billing/provider-sdk';
import type { Discount } from '@paddle/paddle-node-sdk';
import { PADDLE_RESERVED, paddleCustomDataToMetadata } from '../metadata.js';

/**
 * `code` is native: the caller's code is sent to Paddle verbatim (it must
 * redeem there), so Paddle's `code` IS the contract code — and `null` when
 * the discount was created codeless. `restrictedTo`, by contrast, is
 * adapter-managed: Paddle existence-validates `restrict_to` ids while the SDK
 * round-trips arbitrary ones, so it's read back from reserved `customData`,
 * falling back to Paddle's native prefix-typed `restrict_to` for a discount
 * created outside the adapter (e.g. the Paddle dashboard).
 */
function managedRestrictedTo(d: Discount): ProviderDiscount['restrictedTo'] {
  const cd = d.customData as Record<string, unknown> | null;
  const raw = cd?.[PADDLE_RESERVED.DISCOUNT_RESTRICT];
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw) as ProviderDiscount['restrictedTo'];
      return parsed ?? null;
    } catch {
      return null;
    }
  }
  // External discount: fall back to Paddle's native, prefix-typed restrict_to.
  const ids = d.restrictTo;
  if (!ids || ids.length === 0) return null;
  const productIds: string[] = [];
  const priceIds: string[] = [];
  for (const id of ids) {
    if (id.startsWith('pri_')) priceIds.push(id);
    else productIds.push(id);
  }
  const out: { productIds?: string[]; priceIds?: string[] } = {};
  if (productIds.length > 0) out.productIds = productIds;
  if (priceIds.length > 0) out.priceIds = priceIds;
  return out;
}

/**
 * Paddle discount benefit. Paddle's `type` is `percentage` (then `amount` is
 * the percent, e.g. `"15"`) or `flat`/`flat_per_seat` (then `amount` is a
 * minor-unit money string and `currencyCode` is set). `flat_per_seat` is a
 * fixed amount applied per unit; the SDK has no per-seat axis, so it
 * normalizes to the same `amount` benefit shape (the per-seat multiplication
 * is Paddle's concern at redemption time and is reflected in the applied
 * total, not the discount definition).
 */
function benefitOf(d: Discount): DiscountBenefit {
  if (d.type === 'percentage') {
    const pct = Number.parseFloat(d.amount);
    if (!Number.isFinite(pct) || pct <= 0) {
      throw new ProviderNormalizationError({
        message: `Paddle discount ${d.id} has an unparseable percentage amount "${d.amount}"`,
      });
    }
    return { kind: 'percent', percentOff: pct };
  }
  // flat / flat_per_seat — minor-unit money string + currency.
  if (d.currencyCode === null) {
    throw new ProviderNormalizationError({
      message: `Paddle flat discount ${d.id} has no currencyCode`,
    });
  }
  const amount = Number.parseInt(d.amount, 10);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new ProviderNormalizationError({
      message: `Paddle discount ${d.id} has an unparseable flat amount "${d.amount}"`,
    });
  }
  return {
    kind: 'amount',
    amountOff: { amount, currency: normalizeCurrency(d.currencyCode) },
  };
}

/**
 * Paddle expresses recurrence as `recur` + `maximumRecurringIntervals`:
 *   - `recur === false`            → applies once  → SDK `once`
 *   - `recur && max === null`      → applies every cycle forever → SDK `forever`
 *   - `recur && max === N`         → applies for N billing cycles → SDK
 *     `repeating { months: N }`. Paddle's interval is the subscribed price's
 *     billing cycle (not necessarily months); the SDK's `repeating` duration
 *     is month-denominated, so N is surfaced as the cycle count. This is the
 *     closest faithful mapping — documented for live-sandbox verification.
 */
function durationOf(d: Discount): DiscountDuration {
  if (!d.recur) return { kind: 'once' };
  if (d.maximumRecurringIntervals === null) return { kind: 'forever' };
  if (d.maximumRecurringIntervals > 0) {
    return { kind: 'repeating', months: d.maximumRecurringIntervals };
  }
  throw new ProviderNormalizationError({
    message: `Paddle discount ${d.id} has a non-positive maximumRecurringIntervals`,
  });
}

/**
 * Paddle discount → normalized ProviderDiscount. `id` is the Paddle discount
 * id; `code` is the adapter-managed redemption code (null when codeless).
 * `active` reflects Paddle's two-state lifecycle: a discount is "active" only
 * while its status is `active` — `archived` (soft-deleted), `expired`, and
 * `used` (redemption limit hit) all surface as `active: false`.
 */
export function normalizePaddleDiscount(d: Discount): ProviderDiscount<Discount> {
  return {
    id: d.id,
    code: d.code,
    benefit: benefitOf(d),
    duration: durationOf(d),
    active: d.status === 'active',
    expiresAt: d.expiresAt !== null ? new Date(d.expiresAt) : null,
    redemptionLimit: d.usageLimit,
    redemptionCount: d.timesUsed ?? 0,
    restrictedTo: managedRestrictedTo(d),
    metadata: paddleCustomDataToMetadata(d.customData),
    createdAt: new Date(d.createdAt),
    raw: d,
  };
}
