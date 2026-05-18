import type { BillingProvider } from '../billing-provider.js';
import type { ProviderBillingDocument } from '../models/billing-document.js';
import type { ProviderCustomer } from '../models/customer.js';
import type { ProviderDiscount } from '../models/discount.js';
import type { ProviderPaymentMethod } from '../models/payment-method.js';
import type { ProviderPayment } from '../models/payment.js';
import type { ProviderPrice } from '../models/price.js';
import type { ProviderProduct } from '../models/product.js';
import type { ProviderSubscription } from '../models/subscription.js';
import type { TrialSpec } from '../models/trial.js';
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
    /**
     * Optional trial period to apply at subscription creation. When set, the
     * resulting subscription should land in `status: 'trialing'` with a
     * non-null `trialEnd`. Adapters that can't honor a given trial unit
     * (e.g. Stripe rejecting `month`/`year`) should throw
     * `ProviderNotSupportedError` rather than silently approximate.
     */
    trial?: TrialSpec;
  }): Promise<ProviderSubscription>;

  completePayment?(input: { checkoutSessionId: string }): Promise<ProviderPayment>;
}

/**
 * The single pre-provisioned resource the `fixture` conformance suite needs:
 * a subscription. This is the *only* resource the public SDK cannot bootstrap
 * on its own — creating one requires a checkout/payment the SDK doesn't drive.
 * Every other resource (products, prices, customers, discounts, webhook
 * endpoints) is SDK-creatable, so those flows are exercised by the automated
 * and self-setup suites with resources created at test time — they are NOT
 * pre-provisioned here.
 *
 * Providers that CAN create a subscription programmatically (e.g. the mock,
 * or Stripe via `setup.createSubscription` with a test card) exercise the
 * subscription lifecycle through the self-setup suite and need not supply
 * this. Providers that can't (Paddle/Polar — hosted checkout only) hand-
 * provision one subscription and expose its id here.
 *
 * If `subscriptionId` is absent, the subscription fixture tests skip via
 * `it.skipIf`.
 */
export interface ProviderTestFixtures {
  /**
   * A long-lived subscription in a clean starting state: status `active` or
   * `trialing`, `cancelAtPeriodEnd: false`, `pendingChange: null`, exactly
   * one item. Tests perform reversible operations (cancel/change at period
   * end, quantity change) and revert any scheduled change they introduce.
   */
  subscriptionId?: string;
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
  payment?(output: ProviderPayment): Promise<void>;
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
/**
 * Resource kinds the conformance suite tracks for end-of-suite cleanup. Used
 * with {@link ProviderTestHarness.cleanupResource} to give adapters a chance
 * to hard-delete what the SDK contract can only soft-delete.
 */
export type ProviderTrackedKind =
  | 'product'
  | 'price'
  | 'customer'
  | 'discount'
  | 'subscription'
  | 'checkoutSession'
  | 'webhookEndpoint';

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
  /**
   * Optional best-effort hard-delete for a resource created during a test.
   * The conformance suites call this in their `afterAll` blocks before
   * falling back to the contract's soft-delete (`deactivate` / `archive`).
   *
   * Why this exists: the SDK contract intentionally exposes only soft-delete
   * for most resources because real callers want recoverable state. Tests,
   * by contrast, want their residue gone — accumulating archived products
   * and dormant coupons in a Stripe account adds up across hundreds of test
   * runs. Adapters whose underlying provider supports a true delete (e.g.
   * Stripe's `products.del`, `coupons.del`) implement this to drop those
   * resources entirely; the SDK's normal lifecycle methods are unchanged.
   *
   * Implementations should resolve normally when delete succeeds, and may
   * throw or no-op when the provider doesn't permit deletion (Stripe prices,
   * for instance, can never be deleted — soft-delete is the floor). The
   * conformance suite swallows errors and still falls through to the
   * contract's soft-delete as a fallback.
   *
   * When this hook is absent the conformance suites use only the
   * soft-delete path — the same behavior as before this hook existed.
   */
  cleanupResource?(kind: ProviderTrackedKind, id: string): Promise<void>;
  teardown?(): Promise<void>;
}

export type ConformanceSuite = 'automated' | 'self-setup' | 'semi-manual' | 'fixture';
