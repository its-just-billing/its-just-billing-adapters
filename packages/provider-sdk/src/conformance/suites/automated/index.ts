import { describe } from 'vitest';
import type { ProviderTestHarness } from '../../harness.js';
import { registerCapabilitiesAutomatedSuite } from './capabilities.js';
import { registerCheckoutAutomatedSuite } from './checkout.js';
import { registerCustomersAutomatedSuite } from './customers.js';
import { registerDiscountsAutomatedSuite } from './discounts.js';
import { registerEventsAutomatedSuite } from './events.js';
import { registerPricesAutomatedSuite } from './prices.js';
import { registerProductsAutomatedSuite } from './products.js';
import { registerPurchasesAutomatedSuite } from './purchases.js';
import { registerSubscriptionsAutomatedSuite } from './subscriptions.js';
import { registerWebhooksAutomatedSuite } from './webhooks.js';

type HarnessFactory = () => ProviderTestHarness | Promise<ProviderTestHarness>;

/**
 * Register the "automated" conformance suite. Every test here only touches
 * public methods on `BillingProvider`. Runs against every harness.
 *
 * Per-domain suites are registered inside the outer describe so they share
 * the `[automated] ${label}` group in test output.
 */
export function registerAutomatedSuite(label: string, factory: HarnessFactory): void {
  describe(`[automated] ${label}`, () => {
    registerCapabilitiesAutomatedSuite(label, factory);
    registerCustomersAutomatedSuite(label, factory);
    registerProductsAutomatedSuite(label, factory);
    registerPricesAutomatedSuite(label, factory);
    registerDiscountsAutomatedSuite(label, factory);
    registerCheckoutAutomatedSuite(label, factory);
    registerSubscriptionsAutomatedSuite(label, factory);
    registerPurchasesAutomatedSuite(label, factory);
    registerEventsAutomatedSuite(label, factory);
    registerWebhooksAutomatedSuite(label, factory);
  });
}
