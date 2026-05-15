import {
  type Payments,
  type ProviderPayment,
  Schemas,
  validate,
} from '@its-just-billing/provider-sdk';
import type Stripe from 'stripe';
import { isStripeNotFound, mapStripeError } from '../error-mapping.js';
import { normalizeStripeCharge } from '../normalize/payment.js';
import { pageFromStripeList } from '../pagination.js';

/**
 * Resolve the Invoice associated with a Charge when one exists, so the
 * normalizer can surface `subtotal` and `appliedDiscounts`. Expands two
 * complementary paths so the normalizer can recover the full
 * `Stripe.Discount` object for each entry of `total_discount_amounts[]`:
 *
 * - `total_discount_amounts.discount` — populates each line's `discount` field
 *   inline (the natural place the normalizer reads it).
 * - `discounts` — populates the invoice-level `discounts[]` array. The
 *   normalizer falls back to looking up by id here when the inline expansion
 *   above doesn't survive (Stripe's expand paths through arrays have been
 *   inconsistently honored historically; the fallback keeps the surface
 *   robust against API drift).
 *
 * Returns `null` for charges without an invoice (one-time PaymentIntent-only
 * paths) and on any retrieve failure. The normalizer accepts `null`/missing
 * and falls back to `appliedDiscounts: []` + omitted `subtotal`.
 */
async function resolveInvoiceForCharge(
  stripe: Stripe,
  charge: Stripe.Charge,
): Promise<Stripe.Invoice | null> {
  const invoiceRef = charge.invoice;
  if (!invoiceRef) return null;
  const invoiceId = typeof invoiceRef === 'string' ? invoiceRef : invoiceRef.id;
  if (!invoiceId) return null;
  try {
    return await stripe.invoices.retrieve(invoiceId, {
      expand: ['discounts', 'total_discount_amounts.discount'],
    });
  } catch {
    return null;
  }
}

export function createPaymentsDomain(stripe: Stripe): Payments<Stripe.Charge> {
  async function normalizeWithInvoice(
    native: Stripe.Charge,
  ): Promise<ProviderPayment<Stripe.Charge>> {
    const invoice = await resolveInvoiceForCharge(stripe, native);
    return normalizeStripeCharge(native, invoice);
  }

  return {
    async list(input) {
      const parsed =
        input !== undefined
          ? validate(Schemas.Payments.PaymentsListInputSchema, input, 'payments.list')
          : undefined;
      try {
        const native = await stripe.charges.list({
          ...(parsed?.cursor !== undefined ? { starting_after: parsed.cursor } : {}),
          ...(parsed?.limit !== undefined ? { limit: parsed.limit } : {}),
          ...(parsed?.customerId !== undefined ? { customer: parsed.customerId } : {}),
        });
        // Fetch invoices in parallel so subtotal + appliedDiscounts are
        // surfaced symmetrically across list and get. Cost: up to one extra
        // request per charge that has an invoice (subscription renewals,
        // invoice-only one-times). For sub-list pages of 100, this is a
        // bounded fan-out; callers wanting a cheaper read path can drop to
        // `provider.raw.charges.list(...)`.
        const data = await Promise.all(native.data.map(normalizeWithInvoice));
        const last = native.data[native.data.length - 1];
        const nextCursor = native.has_more && last ? last.id : null;
        // Stripe's Charge list API does not support a server-side status
        // filter. Apply it client-side; the page may shrink and `nextCursor`
        // still references the last raw item, preserving forward progress.
        const filtered =
          parsed?.status !== undefined ? data.filter((p) => p.status === parsed.status) : data;
        return { data: filtered, nextCursor };
      } catch (err) {
        // Stripe rejects an unknown customer filter with 404 ("No such
        // customer"). The SDK contract for list is "filtered set, possibly
        // empty" — surface a clean empty page rather than propagating.
        if (parsed?.customerId !== undefined && isStripeNotFound(err)) {
          return { data: [], nextCursor: null };
        }
        throw mapStripeError(err, 'payments.list');
      }
    },

    async get(input) {
      const parsed = validate(Schemas.Payments.PaymentsGetInputSchema, input, 'payments.get');
      try {
        const native = await stripe.charges.retrieve(parsed.id);
        return await normalizeWithInvoice(native);
      } catch (err) {
        if (isStripeNotFound(err)) return null;
        throw mapStripeError(err, 'payments.get');
      }
    },
  };
}
