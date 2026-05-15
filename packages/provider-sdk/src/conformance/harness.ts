import type { BillingProvider } from '../billing-provider.js';
import type { ProviderBillingDocument } from '../models/billing-document.js';
import type { ProviderCustomer } from '../models/customer.js';
import type { ProviderDiscount } from '../models/discount.js';
import type { ProviderPaymentMethod } from '../models/payment-method.js';
import type { ProviderPrice } from '../models/price.js';
import type { ProviderProduct } from '../models/product.js';
import type { ProviderPurchase } from '../models/purchase.js';
import type { ProviderSubscription } from '../models/subscription.js';
import type { ProviderWebhookEndpoint } from '../models/webhook.js';

/**
 * Setup capabilities a provider can optionally expose so the conformance
 * runner can drive flows that the public SDK can't bootstrap (e.g. creating a
 * subscription on Paddle, or completing a checkout without manual card entry).
 *
 * Presence is the capability check. Each test that needs `createSubscription`
 * calls `if (!harness.setup?.createSubscription) skip()`.
 */
export interface ProviderTestSetup {
  createSubscription?(input: {
    customerId: string;
    priceId: string;
    quantity?: number;
  }): Promise<ProviderSubscription>;

  completePurchase?(input: { checkoutSessionId: string }): Promise<ProviderPurchase>;
}

/**
 * IDs of pre-provisioned, reusable resources for the `fixture` conformance
 * suite. The harness reads these from env vars or runtime config and exposes
 * them here; conformance tests assert each resource is in a clean starting
 * state, exercise it through reversible operations, then revert.
 *
 * If a field is absent, fixture tests requiring it skip via `it.skipIf`.
 */
export interface ProviderTestFixtures {
  /** Active customer with no caller metadata. */
  customerId?: string;
  /** Active product, normal tax category, no caller metadata. */
  productId?: string;
  /** Active recurring price attached to `productId`. */
  recurringPriceId?: string;
  /** Active one-time price attached to `productId`. */
  oneTimePriceId?: string;
  /**
   * Active subscription whose status is `active` or `trialing`,
   * `cancelAtPeriodEnd: false`, `pendingChange: null`. Tests revert any
   * scheduled changes they introduce.
   */
  subscriptionId?: string;
  /** Active discount, no redemption-limit reached, `expiresAt: null`. */
  discountId?: string;
  /**
   * Active webhook endpoint subscribed to a stable set of normalized event
   * types. Update tests record the prior `eventTypes` and restore them.
   */
  webhookEndpointId?: string;
}

/**
 * Per-model consistency verifiers. Conformance calls these after every
 * successful write to assert the normalized output reflects what the provider
 * actually persisted — independently of any adapter caching.
 *
 * Adapter harnesses implement these using the provider's native SDK to make a
 * fresh call that bypasses the adapter, then assert the native state agrees
 * with the normalized output. Mock harnesses typically omit `assertConsistency`
 * entirely since the mock's in-memory state is the source of truth.
 *
 * A thrown error from any verifier fails the calling test. Absent verifiers
 * silently no-op (`await harness.assertConsistency?.subscription?.(sub)`).
 */
export interface ProviderConsistencyChecks {
  customer?(output: ProviderCustomer): Promise<void>;
  product?(output: ProviderProduct): Promise<void>;
  price?(output: ProviderPrice): Promise<void>;
  subscription?(output: ProviderSubscription): Promise<void>;
  purchase?(output: ProviderPurchase): Promise<void>;
  discount?(output: ProviderDiscount): Promise<void>;
  webhookEndpoint?(output: ProviderWebhookEndpoint): Promise<void>;
  billingDocument?(output: ProviderBillingDocument): Promise<void>;
  paymentMethod?(output: ProviderPaymentMethod): Promise<void>;
}

/**
 * A harness wraps a provider instance plus optional setup capabilities, an
 * interactive prompt, pre-provisioned fixtures, and consistency verifiers.
 * Conformance suites consume the harness; they never import a concrete
 * provider package.
 *
 * `TCheckoutPresentation` parameterizes the provider-specific checkout
 * presentation shape (see `BillingProvider<TCheckoutPresentation>`). Default
 * `unknown` keeps adapter-agnostic conformance suites honest.
 */
export interface ProviderTestHarness<TCheckoutPresentation = unknown> {
  /** Human label used in test output, e.g. "mock", "stripe". */
  readonly label: string;
  readonly provider: BillingProvider<TCheckoutPresentation>;
  readonly setup?: ProviderTestSetup;
  readonly fixtures?: ProviderTestFixtures;
  readonly assertConsistency?: ProviderConsistencyChecks;
  /**
   * Interactive prompt for semi-manual flows. The runner skips semi-manual
   * tests entirely when this is absent or when `process.env.INTERACTIVE` is
   * not truthy.
   */
  prompt?(message: string): Promise<string>;
  teardown?(): Promise<void>;
}

export type ConformanceSuite = 'automated' | 'self-setup' | 'semi-manual' | 'fixture';
