import {
  type Checkout,
  type CheckoutLineItem,
  ProviderConstraintError,
  ProviderNotFoundError,
  Schemas,
  assertNoReservedKeys,
  assertQuantityWithinConstraint,
  validate,
} from '@its-just-billing/provider-sdk';
import type Stripe from 'stripe';
import { isStripeNotFound, mapStripeError } from '../error-mapping.js';
import {
  normalizeStripeCheckoutSession,
  stripeLineItemToCheckoutLineItem,
} from '../normalize/checkout.js';
import { normalizeStripePrice } from '../normalize/price.js';
import type { StripeCheckoutPresentation } from '../presentation.js';

export function createCheckoutDomain(
  stripe: Stripe,
): Checkout<StripeCheckoutPresentation, Stripe.Checkout.Session> {
  return {
    async createSession(input) {
      const parsed = validate(
        Schemas.Checkout.CheckoutCreateSessionInputSchema,
        input,
        'checkout.createSession',
      );
      assertNoReservedKeys(parsed.metadata, 'checkout.createSession');

      // Pre-flight: load each price, validate active + per-line-item quantity
      // bounds, and verify all line items share a single currency. These
      // checks happen before any Stripe write so failures surface cleanly.
      let sessionCurrency: string | null = null;
      let mode: 'payment' | 'subscription' = 'payment';
      for (const li of parsed.lineItems) {
        let priceNative: Stripe.Price;
        try {
          priceNative = await stripe.prices.retrieve(li.priceId);
        } catch (err) {
          if (isStripeNotFound(err)) {
            throw new ProviderNotFoundError({ message: `Price ${li.priceId} not found` });
          }
          throw mapStripeError(err, 'checkout.createSession');
        }
        if (!priceNative.active) {
          throw new ProviderConstraintError({ message: `Price ${priceNative.id} is inactive` });
        }
        const price = normalizeStripePrice(priceNative);
        if (sessionCurrency === null) {
          sessionCurrency = price.currency;
        } else if (price.currency !== sessionCurrency) {
          throw new ProviderConstraintError({
            message: `Line items mix currencies (${sessionCurrency} and ${price.currency}); a checkout session must use a single currency`,
            details: { expected: sessionCurrency, found: price.currency },
          });
        }
        assertQuantityWithinConstraint(li.quantity, price.quantity, 'checkout.createSession');
        if (price.kind === 'recurring') mode = 'subscription';
      }

      // Customer must exist + not be deleted (Stripe's archived equivalent).
      if (parsed.customerId) {
        try {
          const cust = await stripe.customers.retrieve(parsed.customerId);
          if ('deleted' in cust && cust.deleted) {
            throw new ProviderNotFoundError({
              message: `Customer ${parsed.customerId} not found`,
            });
          }
        } catch (err) {
          if (isStripeNotFound(err)) {
            throw new ProviderNotFoundError({
              message: `Customer ${parsed.customerId} not found`,
            });
          }
          throw mapStripeError(err, 'checkout.createSession');
        }
      }

      // Resolve and validate discount before opening the session.
      let discountParam: Stripe.Checkout.SessionCreateParams.Discount | undefined;
      let allowPromotionCodes = false;
      if (parsed.discount) {
        if (parsed.discount.kind === 'discountId') {
          let pc: Stripe.PromotionCode;
          try {
            pc = await stripe.promotionCodes.retrieve(parsed.discount.discountId);
          } catch (err) {
            if (isStripeNotFound(err)) {
              throw new ProviderNotFoundError({
                message: `Discount ${parsed.discount.discountId} not found`,
              });
            }
            throw mapStripeError(err, 'checkout.createSession');
          }
          if (!pc.active) {
            throw new ProviderConstraintError({ message: `Discount ${pc.id} is inactive` });
          }
          discountParam = { promotion_code: pc.id };
        } else if (parsed.discount.kind === 'code') {
          const code = parsed.discount.code;
          let found: Stripe.PromotionCode | null = null;
          try {
            const list = await stripe.promotionCodes.list({ code, limit: 1 });
            found = list.data[0] ?? null;
          } catch (err) {
            throw mapStripeError(err, 'checkout.createSession');
          }
          if (!found) {
            throw new ProviderNotFoundError({ message: `Discount code ${code} not found` });
          }
          if (!found.active) {
            throw new ProviderConstraintError({
              message: `Discount code ${code} is inactive`,
            });
          }
          discountParam = { promotion_code: found.id };
        } else {
          // 'allowPromotionCodes' kind. Stripe rejects combining
          // `discounts` and `allow_promotion_codes`; we only set the latter.
          allowPromotionCodes = true;
        }
      }

      const params: Stripe.Checkout.SessionCreateParams = {
        mode,
        ui_mode: 'hosted',
        success_url: parsed.successUrl,
        line_items: parsed.lineItems.map((li) => ({
          price: li.priceId,
          quantity: li.quantity,
        })),
        ...(parsed.cancelUrl !== undefined ? { cancel_url: parsed.cancelUrl } : {}),
        ...(parsed.customerId !== undefined ? { customer: parsed.customerId } : {}),
        ...(parsed.metadata !== undefined ? { metadata: { ...parsed.metadata } } : {}),
        ...(discountParam ? { discounts: [discountParam] } : {}),
        ...(allowPromotionCodes ? { allow_promotion_codes: true } : {}),
      };

      try {
        const native = await stripe.checkout.sessions.create(params);
        return normalizeStripeCheckoutSession(native, parsed.lineItems);
      } catch (err) {
        throw mapStripeError(err, 'checkout.createSession');
      }
    },

    async getSession(input) {
      const parsed = validate(
        Schemas.Checkout.CheckoutGetSessionInputSchema,
        input,
        'checkout.getSession',
      );
      let native: Stripe.Checkout.Session;
      try {
        native = await stripe.checkout.sessions.retrieve(parsed.id);
      } catch (err) {
        if (isStripeNotFound(err)) return null;
        throw mapStripeError(err, 'checkout.getSession');
      }
      // Stripe's inline `expand: ['line_items']` only ever embeds the first
      // page (typically 10 items). For a session whose cart exceeded that,
      // we'd return a truncated `lineItems` array — silently dropping items
      // the caller created. Use the dedicated listLineItems endpoint and
      // auto-paginate so the normalized session always carries the full set
      // regardless of cart size.
      const lineItems: CheckoutLineItem[] = [];
      try {
        for await (const item of stripe.checkout.sessions.listLineItems(parsed.id, {
          limit: 100,
        })) {
          lineItems.push(stripeLineItemToCheckoutLineItem(item));
        }
      } catch (err) {
        if (isStripeNotFound(err)) return null;
        throw mapStripeError(err, 'checkout.getSession');
      }
      return normalizeStripeCheckoutSession(native, lineItems);
    },
  };
}
