import { describe } from 'vitest';
import type { ProviderTestHarness } from '../../harness.js';
import { registerCustomersFixtureSuite } from './customers.js';
import { registerDiscountsFixtureSuite } from './discounts.js';
import { registerPricesFixtureSuite } from './prices.js';
import { registerProductsFixtureSuite } from './products.js';
import { registerSubscriptionsFixtureSuite } from './subscriptions.js';
import { registerWebhooksFixtureSuite } from './webhooks.js';

type HarnessFactory = () => ProviderTestHarness | Promise<ProviderTestHarness>;

/**
 * Register the "fixture" conformance suite. Tests here exercise
 * pre-provisioned resources declared via `harness.fixtures`. Each test
 * asserts the resource is healthy, runs reversible operations, and reverts.
 *
 * Tests are gated on `it.skipIf(!harness.fixtures?.<id>)` per fixture key.
 * The whole suite is otherwise unconditionally registered — harnesses that
 * supply no fixtures simply have every test skip.
 *
 * Per-domain suites will be registered here in a follow-up pass via the
 * two-agent runbook.
 */
export function registerFixtureSuite(label: string, factory: HarnessFactory): void {
  describe(`[fixture] ${label}`, () => {
    registerCustomersFixtureSuite(label, factory);
    registerDiscountsFixtureSuite(label, factory);
    registerPricesFixtureSuite(label, factory);
    registerProductsFixtureSuite(label, factory);
    registerSubscriptionsFixtureSuite(label, factory);
    registerWebhooksFixtureSuite(label, factory);
  });
}
