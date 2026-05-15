import { type Purchases, Schemas, validate } from '@its-just-billing/provider-sdk';
import type Stripe from 'stripe';
import { isStripeNotFound, mapStripeError } from '../error-mapping.js';
import { normalizeStripeCharge } from '../normalize/purchase.js';
import { pageFromStripeList } from '../pagination.js';

export function createPurchasesDomain(stripe: Stripe): Purchases<Stripe.Charge> {
  return {
    async list(input) {
      const parsed =
        input !== undefined
          ? validate(Schemas.Purchases.PurchasesListInputSchema, input, 'purchases.list')
          : undefined;
      try {
        const native = await stripe.charges.list({
          ...(parsed?.cursor !== undefined ? { starting_after: parsed.cursor } : {}),
          ...(parsed?.limit !== undefined ? { limit: parsed.limit } : {}),
          ...(parsed?.customerId !== undefined ? { customer: parsed.customerId } : {}),
        });
        const page = pageFromStripeList(native, normalizeStripeCharge);
        // Stripe's Charge list API does not support a server-side status
        // filter. Apply it client-side; the page may shrink and `nextCursor`
        // still references the last raw item, preserving forward progress.
        if (parsed?.status !== undefined) {
          page.data = page.data.filter((p) => p.status === parsed.status);
        }
        return page;
      } catch (err) {
        // Stripe rejects an unknown customer filter with 404 ("No such
        // customer"). The SDK contract for list is "filtered set, possibly
        // empty" — surface a clean empty page rather than propagating.
        if (parsed?.customerId !== undefined && isStripeNotFound(err)) {
          return { data: [], nextCursor: null };
        }
        throw mapStripeError(err, 'purchases.list');
      }
    },

    async get(input) {
      const parsed = validate(Schemas.Purchases.PurchasesGetInputSchema, input, 'purchases.get');
      try {
        const native = await stripe.charges.retrieve(parsed.id);
        return normalizeStripeCharge(native);
      } catch (err) {
        if (isStripeNotFound(err)) return null;
        throw mapStripeError(err, 'purchases.get');
      }
    },
  };
}
