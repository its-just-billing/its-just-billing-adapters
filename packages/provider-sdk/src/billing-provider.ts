import type {
  BillingDocuments,
  Checkout,
  Customers,
  Discounts,
  Events,
  PaymentMethods,
  Portal,
  Prices,
  Products,
  Purchases,
  Subscriptions,
  Webhooks,
} from './domains/index.js';

/**
 * The umbrella interface that every billing provider adapter implements.
 *
 * Required domains are always present on a real provider. Optional domains
 * (`portal`, `billingDocuments`, `paymentMethods`) are presence-based — callers
 * check `if (provider.portal)` to detect support; there is no `capabilities`
 * object.
 *
 * `TCheckoutPresentation` parameterizes the provider-specific presentation
 * payload returned by `checkout.createSession` / `getSession`. Checkout is the
 * one domain that straddles the backend/frontend boundary, so its output is
 * partly normalized and partly provider-specific. Adapter-agnostic code uses
 * `BillingProvider<unknown>` (the default); code that knows which adapter
 * it's binding to narrows the parameter and gets full type information on
 * `session.presentation`.
 *
 * The `raw` field is a documented escape hatch for provider-native operations
 * the normalized contract does not cover (e.g. Stripe-only or Paddle-only
 * actions). Adapters must not leak raw data through normalized fields.
 */
export interface BillingProvider<TCheckoutPresentation = unknown> {
  readonly providerId: string;

  customers: Customers;
  products: Products;
  prices: Prices;
  subscriptions: Subscriptions;
  checkout: Checkout<TCheckoutPresentation>;
  purchases: Purchases;
  discounts: Discounts;
  events: Events;
  webhooks: Webhooks;

  portal?: Portal;
  billingDocuments?: BillingDocuments;
  paymentMethods?: PaymentMethods;

  raw?: unknown;
}
