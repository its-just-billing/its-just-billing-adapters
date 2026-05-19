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
import type {
  Customer,
  Discount,
  EventEntity,
  NotificationSettings,
  Paddle,
  Price,
  Product,
  Subscription,
  Transaction,
} from '@paddle/paddle-node-sdk';
import { PADDLE_CAPABILITIES } from './capabilities.js';
import { type CreatePaddleClientOptions, createPaddleClient } from './client.js';
import { createCheckoutDomain } from './domains/checkout.js';
import { createCustomersDomain } from './domains/customers.js';
import { createDiscountsDomain } from './domains/discounts.js';
import { createEventsDomain } from './domains/events.js';
import { createPaymentsDomain } from './domains/payments.js';
import { createPricesDomain } from './domains/prices.js';
import { createProductsDomain } from './domains/products.js';
import { createSubscriptionsDomain } from './domains/subscriptions.js';
import { createWebhooksDomain } from './domains/webhooks.js';
import type { PaddleCheckoutPresentation } from './presentation.js';

export type { PaddleCheckoutPresentation } from './presentation.js';
export type { CreatePaddleClientOptions } from './client.js';
export { PADDLE_CAPABILITIES } from './capabilities.js';
export { TAX_CATEGORY_TO_PADDLE, paddleToTaxCategory } from './tax-codes.js';
export { mapPaddleError, isPaddleNotFound } from './error-mapping.js';
export { trialToPaddleDuration } from './trial-translation.js';
export { normalizePaddleCustomer } from './normalize/customer.js';
export { normalizePaddleProduct } from './normalize/product.js';
export { normalizePaddlePrice } from './normalize/price.js';
export { normalizePaddleTransaction } from './normalize/payment.js';
export { normalizePaddleSubscription } from './normalize/subscription.js';
export { normalizePaddleCheckoutTransaction } from './normalize/checkout.js';
export { normalizePaddleDiscount } from './normalize/discount.js';
export { normalizePaddleNotificationSetting } from './normalize/webhook-endpoint.js';
export {
  maybeNormalizePaddleEvent,
  PADDLE_TO_NORMALIZED_EVENT,
  NORMALIZED_TO_PADDLE_EVENT,
} from './normalize/event.js';

/**
 * Narrow provider type. Adapter-aware callers import this to get a typed
 * `raw` on the top-level Paddle client and on every per-response object.
 */
export interface PaddleProvider extends BillingProvider<PaddleCheckoutPresentation> {
  readonly raw: Paddle;
  customers: Customers<Customer>;
  products: Products<Product>;
  prices: Prices<Price>;
  subscriptions: Subscriptions<Subscription>;
  payments: Payments<Transaction>;
  discounts: Discounts<Discount>;
  events: Events<unknown, EventEntity>;
  webhooks: Webhooks<NotificationSettings, EventEntity>;
  // Re-declare `checkout` with both generics filled in — `BillingProvider`
  // only forwards `TCheckoutPresentation`, leaving `Checkout`'s `TRaw` at
  // `unknown`. Domain construction already returns the narrower type at
  // runtime; this just exposes it to adapter-aware callers.
  checkout: Checkout<PaddleCheckoutPresentation, Transaction>;
}

export interface CreatePaddleProviderOptions extends CreatePaddleClientOptions {
  /**
   * Base hosted-checkout link (a Paddle-hosted payment link, e.g.
   * `https://…paddle.io/hsc_…`, or your own Paddle.js page). The adapter
   * builds the `paddle_hosted` presentation URL by appending
   * `?_ptxn=<transactionId>` to it — it is NOT sent as the transaction's
   * `checkout.url` (Paddle only accepts an account-approved domain there).
   * The env var is resolved by the caller (e.g. the conformance harness),
   * not here. When omitted, the presentation falls back to whatever
   * `transaction.checkout.url` Paddle attaches from the account default
   * payment link, or `paddle_overlay` when there is none.
   */
  hostedCheckoutUrl?: string;
}

export function createPaddleProvider(opts: CreatePaddleProviderOptions): PaddleProvider {
  const paddle: Paddle = createPaddleClient(opts);

  return {
    providerId: 'paddle',
    capabilities: PADDLE_CAPABILITIES,
    customers: createCustomersDomain(paddle),
    products: createProductsDomain(paddle, PADDLE_CAPABILITIES),
    prices: createPricesDomain(paddle, PADDLE_CAPABILITIES),
    subscriptions: createSubscriptionsDomain(paddle),
    checkout: createCheckoutDomain(paddle, opts.hostedCheckoutUrl),
    payments: createPaymentsDomain(paddle),
    discounts: createDiscountsDomain(paddle, PADDLE_CAPABILITIES),
    events: createEventsDomain(paddle),
    webhooks: createWebhooksDomain(paddle),
    raw: paddle,
  };
}
