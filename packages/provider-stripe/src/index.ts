import type {
  BillingProvider,
  Checkout,
  Customers,
  Discounts,
  Events,
  Payments,
  Prices,
  Products,
  Subscriptions,
  Webhooks,
} from '@its-just-billing/provider-sdk';
import Stripe from 'stripe';
import { STRIPE_CAPABILITIES } from './capabilities.js';
import { createCheckoutDomain } from './domains/checkout.js';
import { createCustomersDomain } from './domains/customers.js';
import { createDiscountsDomain } from './domains/discounts.js';
import { createEventsDomain } from './domains/events.js';
import { createPaymentsDomain } from './domains/payments.js';
import { createPricesDomain } from './domains/prices.js';
import { createProductsDomain } from './domains/products.js';
import { createSubscriptionsDomain } from './domains/subscriptions.js';
import { createWebhooksDomain } from './domains/webhooks.js';
import type { StripeCheckoutPresentation } from './presentation.js';

export type { StripeCheckoutPresentation } from './presentation.js';
export { STRIPE_CAPABILITIES } from './capabilities.js';
export { TAX_CATEGORY_TO_STRIPE, stripeToTaxCategory } from './tax-codes.js';
export { mapStripeError, isStripeNotFound } from './error-mapping.js';
export { normalizeStripeCustomer } from './normalize/customer.js';
export { normalizeStripeProduct } from './normalize/product.js';
export { normalizeStripePrice } from './normalize/price.js';
export { normalizeStripeCharge } from './normalize/payment.js';
export { normalizeStripeSubscription } from './normalize/subscription.js';
export { normalizeStripeCheckoutSession } from './normalize/checkout.js';
export { normalizeStripePromotionCode } from './normalize/discount.js';
export { normalizeStripeWebhookEndpoint } from './normalize/webhook-endpoint.js';
export {
  maybeNormalizeStripeEvent,
  STRIPE_TO_NORMALIZED_EVENT,
  NORMALIZED_TO_STRIPE_EVENT,
} from './normalize/event.js';

/**
 * Narrow provider type. Adapter-aware callers import this to get a typed
 * `raw` on the top-level Stripe client and on every per-response object.
 */
export interface StripeProvider extends BillingProvider<StripeCheckoutPresentation> {
  readonly raw: Stripe;
  customers: Customers<Stripe.Customer>;
  products: Products<Stripe.Product>;
  prices: Prices<Stripe.Price>;
  subscriptions: Subscriptions<Stripe.Subscription>;
  payments: Payments<Stripe.Charge>;
  discounts: Discounts<Stripe.PromotionCode>;
  events: Events<unknown, Stripe.Event>;
  webhooks: Webhooks<Stripe.WebhookEndpoint, Stripe.Event>;
  // Re-declare `checkout` with both generics filled in. `BillingProvider`
  // only forwards `TCheckoutPresentation`, leaving `Checkout`'s second
  // generic (`TRaw`) at `unknown` — which would type `session.raw` as
  // `unknown` even though the adapter knows it's a Stripe checkout session.
  // Domain construction at runtime already returns the narrower type; this
  // just exposes it to adapter-aware callers.
  checkout: Checkout<StripeCheckoutPresentation, Stripe.Checkout.Session>;
}

export interface CreateStripeProviderOptions {
  /** Stripe secret API key, e.g. `sk_test_...`. */
  apiKey: string;
  /** Stripe API version pin; defaults to the SDK's `LatestApiVersion`. */
  apiVersion?: Stripe.LatestApiVersion;
  /**
   * Existing Stripe client to reuse. Tests in particular can construct one
   * with a custom `httpClient` and pass it through. When supplied, `apiKey`
   * and `apiVersion` are ignored.
   */
  client?: Stripe;
}

export function createStripeProvider(opts: CreateStripeProviderOptions): StripeProvider {
  const stripe: Stripe =
    opts.client ??
    new Stripe(opts.apiKey, {
      ...(opts.apiVersion !== undefined ? { apiVersion: opts.apiVersion } : {}),
    });

  return {
    providerId: 'stripe',
    capabilities: STRIPE_CAPABILITIES,
    customers: createCustomersDomain(stripe),
    products: createProductsDomain(stripe, STRIPE_CAPABILITIES),
    prices: createPricesDomain(stripe, STRIPE_CAPABILITIES),
    subscriptions: createSubscriptionsDomain(stripe),
    checkout: createCheckoutDomain(stripe),
    payments: createPaymentsDomain(stripe),
    discounts: createDiscountsDomain(stripe),
    events: createEventsDomain(stripe),
    webhooks: createWebhooksDomain(stripe),
    raw: stripe,
  };
}
