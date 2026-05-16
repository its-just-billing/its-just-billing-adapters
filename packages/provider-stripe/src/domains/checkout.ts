import {
  type Checkout,
  type CheckoutLineItem,
  Schemas,
  assertCapabilityValueSupported,
  assertNoReservedKeys,
  validate,
} from '@its-just-billing/provider-sdk';
import type Stripe from 'stripe';
import { STRIPE_CAPABILITIES } from '../capabilities.js';
import { isStripeNotFound, mapStripeError } from '../error-mapping.js';
import {
  normalizeStripeCheckoutSession,
  stripeLineItemToCheckoutLineItem,
} from '../normalize/checkout.js';
import type { StripeCheckoutPresentation } from '../presentation.js';
import { trialToStripeDays } from '../trial-translation.js';

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

      // Pure pass-through: map normalized fields straight onto Stripe's
      // session create call and let Stripe accept/reject. No pre-flight
      // retrieves — the consumer holds price recurrence/quantity/currency in
      // its own persistence and supplies `mode`; an inactive price, a
      // currency mix, or a bad discount id is rejected by Stripe and surfaced
      // via mapStripeError.
      const mode = parsed.mode;

      // Discount: pass the resolved id straight through. There is no `code`
      // kind — the consumer resolves human codes from its own store.
      let discountParam: Stripe.Checkout.SessionCreateParams.Discount | undefined;
      let allowPromotionCodes = false;
      if (parsed.discount) {
        if (parsed.discount.kind === 'discountId') {
          discountParam = { promotion_code: parsed.discount.discountId };
        } else {
          // 'allowPromotionCodes' kind. Stripe rejects combining
          // `discounts` and `allow_promotion_codes`; we only set the latter.
          allowPromotionCodes = true;
        }
      }

      // Trial: capability-gate the unit (hard invariant — Stripe is day-only),
      // then translate to Stripe's `trial_period_days`. Cheap, no round trip.
      // Stripe itself rejects `subscription_data` on a payment-mode session.
      let trialDays: number | undefined;
      if (parsed.trial !== undefined) {
        assertCapabilityValueSupported(
          STRIPE_CAPABILITIES.trialUnits,
          parsed.trial.unit,
          'trial.unit',
          'checkout.createSession',
        );
        trialDays = trialToStripeDays(parsed.trial);
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
        ...(trialDays !== undefined ? { subscription_data: { trial_period_days: trialDays } } : {}),
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
