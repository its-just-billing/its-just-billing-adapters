import { describe } from 'vitest';
import type { ProviderTestHarness } from '../../harness.js';
import { registerSubscriptionsFixtureSuite } from './subscriptions.js';

type HarnessFactory = () => ProviderTestHarness | Promise<ProviderTestHarness>;

/**
 * Register the "fixture" conformance suite.
 *
 * Scope: **subscriptions only**. A subscription is the one resource the
 * public SDK cannot bootstrap on its own (creating one needs a
 * checkout/payment the SDK doesn't drive), so it is the only thing worth
 * pre-provisioning and reusing across runs. Every other resource is
 * SDK-creatable and its lifecycle is covered by the automated/self-setup
 * suites with resources created at test time — there are deliberately no
 * product/price/customer/discount/webhook fixture domains.
 *
 * The factory is memoized so the (single) domain registrar and the
 * subscription it pins resolve one shared harness instance. There is no
 * teardown — the pre-provisioned subscription is reused; any scaffolding a
 * scenario creates at test time cleans up after itself.
 *
 * Tests gate on `harness.fixtures?.subscriptionId`; harnesses that can create
 * subscriptions programmatically (mock, Stripe via `setup.createSubscription`)
 * cover this through self-setup instead and may supply no fixture, in which
 * case every test here skips.
 */
export function registerFixtureSuite(label: string, factory: HarnessFactory): void {
  let harnessPromise: Promise<ProviderTestHarness> | undefined;
  const sharedFactory: HarnessFactory = () => {
    if (!harnessPromise) harnessPromise = Promise.resolve(factory());
    return harnessPromise;
  };

  describe(`[fixture] ${label}`, () => {
    registerSubscriptionsFixtureSuite(label, sharedFactory);
  });
}
