import type { BillingProvider } from '../billing-provider.js';
import type { ProviderPurchase } from '../models/purchase.js';
import type { ProviderSubscription } from '../models/subscription.js';

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
 * A harness wraps a provider instance plus optional setup capabilities and an
 * interactive prompt. Conformance suites consume the harness; they never
 * import a concrete provider package.
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
  /**
   * Interactive prompt for semi-manual flows. The runner skips semi-manual
   * tests entirely when this is absent or when `process.env.INTERACTIVE` is
   * not truthy.
   */
  prompt?(message: string): Promise<string>;
  teardown?(): Promise<void>;
}

export type ConformanceSuite = 'automated' | 'self-setup' | 'semi-manual';
