import type {
  BillingDocuments,
  Checkout,
  Customers,
  Discounts,
  Events,
  PaymentMethods,
  Payments,
  Portal,
  Prices,
  Products,
  Subscriptions,
  Webhooks,
} from './domains/index.js';
import type { ProviderCapabilities } from './models/capabilities.js';

/**
 * The umbrella interface that every billing provider adapter implements.
 *
 * Required domains are always present on a real provider. Optional domains
 * (`portal`, `billingDocuments`, `paymentMethods`) are presence-based — callers
 * check `if (provider.portal)` to detect support; there is no domain-level
 * capabilities object.
 *
 * Within-domain value-set capabilities (e.g. which tax categories or
 * currencies the provider accepts) are exposed via `capabilities`. This is
 * the only legal capability surface; new axes go in there or nowhere.
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
  readonly capabilities: ProviderCapabilities;

  customers: Customers;
  products: Products;
  prices: Prices;
  subscriptions: Subscriptions;
  checkout: Checkout<TCheckoutPresentation>;
  payments: Payments;
  discounts: Discounts;
  events: Events;
  webhooks: Webhooks;

  portal?: Portal;
  billingDocuments?: BillingDocuments;
  paymentMethods?: PaymentMethods;

  raw?: unknown;
}
