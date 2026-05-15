import {
  type AppliedDiscount,
  type Money,
  type PaymentStatus,
  type ProviderPayment,
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

function statusOf(c: Stripe.Charge): PaymentStatus {
  if (c.status === 'pending') return 'pending';
  if (c.status === 'failed') return 'failed';
  // succeeded:
  if (c.refunded) return 'refunded';
  if (c.amount_refunded > 0) return 'partially_refunded';
  return 'succeeded';
}

/**
 * Extract the public `discountId` (Stripe PromotionCode id) from a
 * `Stripe.Discount` if it has one. Returns null when the discount was
 * applied directly via the coupon (no promotion code). The SDK identifies
 * discounts by PromotionCode id everywhere — coupon-only discounts can't
 * be refetched via `discounts.get`, so we mirror the event-mapping rule
 * and intentionally drop them from `appliedDiscounts`.
 */
function promotionCodeIdOf(discount: Stripe.Discount): string | null {
  const pc = discount.promotion_code;
  if (typeof pc === 'string') return pc;
  if (pc && typeof pc === 'object') return pc.id;
  return null;
}

function promotionCodeStringOf(discount: Stripe.Discount): string | null {
  const pc = discount.promotion_code;
  if (pc && typeof pc === 'object' && typeof pc.code === 'string') return pc.code;
  return null;
}

/**
 * Read applied-discount lines from an Invoice when one is reachable for the
 * Charge (subscription renewals, invoice-backed payments). `total_discount_
 * amounts[]` has the right cardinality (one entry per applied discount).
 *
 * Each line's `discount` field is `string | Stripe.Discount`. The domain layer
 * asks Stripe to expand both `total_discount_amounts.discount` (the inline
 * path) and `discounts` (the invoice-level array) so this normalizer has
 * two sources to resolve a full Discount object from:
 *
 *   1. `line.discount` is already an expanded Discount → use it directly.
 *   2. `line.discount` is a string id → look it up in `invoice.discounts[]`,
 *      which the invoice-level expand populates with Discount objects keyed
 *      by id.
 *   3. Neither path resolves → silently drop this entry. The discount was
 *      applied (the cart total reflects it) but the SDK can't surface a
 *      refetchable identity without the full object; the contract chooses
 *      "honest empty" over "leak a coupon id that discounts.get rejects".
 *
 * Returns the (possibly empty) array of resolved, SDK-visible discounts.
 * Returns `[]` when the invoice has `total_discount_amounts: null` (no
 * discounts applied) or when every entry is coupon-only / unresolvable.
 */
function appliedDiscountsFromInvoice(
  invoice: Stripe.Invoice,
  currency: string,
): AppliedDiscount[] {
  const totals = invoice.total_discount_amounts;
  if (!totals) return [];

  // Build a fallback id-to-Discount lookup from the invoice-level `discounts`
  // array, which expands cleanly via `expand: ['discounts']`. Stripe's deep
  // expand on `total_discount_amounts.discount` is honored in most API
  // versions but has been spotty historically; the lookup keeps the read
  // path robust without paying a second round trip.
  const byId = new Map<string, Stripe.Discount>();
  const invoiceDiscounts: unknown = invoice.discounts;
  if (Array.isArray(invoiceDiscounts)) {
    for (const d of invoiceDiscounts) {
      if (
        d &&
        typeof d === 'object' &&
        'id' in d &&
        typeof (d as { id: unknown }).id === 'string'
      ) {
        byId.set((d as { id: string }).id, d as Stripe.Discount);
      }
    }
  }

  const out: AppliedDiscount[] = [];
  for (const line of totals) {
    const discountField: unknown = line.discount;
    let discount: Stripe.Discount | null = null;
    if (discountField && typeof discountField === 'object') {
      discount = discountField as Stripe.Discount;
    } else if (typeof discountField === 'string') {
      discount = byId.get(discountField) ?? null;
    }
    if (!discount) continue; // unresolved — see strategy comment above
    const discountId = promotionCodeIdOf(discount);
    if (!discountId) continue; // coupon-only — intentionally invisible to SDK
    out.push({
      discountId,
      code: promotionCodeStringOf(discount),
      amountDiscounted: { amount: line.amount, currency },
    });
  }
  return out;
}

/**
 * Normalize a Stripe Charge into the SDK's ProviderPayment.
 *
 * When the Charge is invoice-backed (subscription renewals + invoice-only
 * one-times), pass the retrieved Invoice as the second argument so the
 * normalizer can surface `subtotal` and `appliedDiscounts` from it. The
 * Invoice should be retrieved with both `total_discount_amounts.discount`
 * and `discounts` expanded so the per-line discount object is resolvable
 * (see `resolveInvoiceForCharge`). Entries whose Discount can't be resolved
 * via either expansion are silently dropped — see
 * {@link appliedDiscountsFromInvoice}.
 *
 * For one-time PaymentIntent-only charges (no invoice), the Charge alone
 * has no discount field, so `subtotal` is omitted and `appliedDiscounts`
 * resolves to `[]`. Future work: walk back to the CheckoutSession when
 * `charge.payment_intent` exists, to recover discount info there.
 */
export function normalizeStripeCharge(
  native: Stripe.Charge,
  invoice?: Stripe.Invoice | null,
): ProviderPayment<Stripe.Charge> {
  const currency = normalizeCurrency(native.currency);

  let appliedDiscounts: AppliedDiscount[] = [];
  let subtotal: Money | undefined;
  if (invoice) {
    appliedDiscounts = appliedDiscountsFromInvoice(invoice, currency);
    if (typeof invoice.subtotal_excluding_tax === 'number') {
      subtotal = { amount: invoice.subtotal_excluding_tax, currency };
    } else if (typeof invoice.subtotal === 'number') {
      subtotal = { amount: invoice.subtotal, currency };
    }
  }

  return {
    id: native.id,
    customerId: customerIdOf(native),
    status: statusOf(native),
    amount: { amount: native.amount, currency },
    ...(subtotal !== undefined ? { subtotal } : {}),
    amountRefunded:
      native.amount_refunded > 0 ? { amount: native.amount_refunded, currency } : null,
    appliedDiscounts,
    // The normalized contract surfaces priceId/productId/checkoutSessionId for
    // a one-time payment. Stripe Charges don't reference any of those
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
