import type { ProviderTestHarness } from '@its-just-billing/provider-sdk/conformance';
import { type MockCheckoutPresentation, type MockProvider, createMockProvider } from './index.js';

/**
 * Build a fresh conformance harness backed by an in-memory mock provider.
 *
 * The mock can self-create subscriptions and complete purchases, so both
 * `setup.createSubscription` and `setup.completePurchase` are provided. When
 * `seedFixtures` is true (the default) the harness pre-provisions one resource
 * per fixture key so the fixture suite exercises every gated test.
 *
 * No `assertConsistency` is supplied: the in-memory store IS the source of
 * truth for the mock, so an independent verification path would only assert
 * "the data we just returned matches the data we just stored."
 */
export interface MockHarnessOptions {
  seedFixtures?: boolean;
}

export type MockHarness = ProviderTestHarness<MockCheckoutPresentation> & {
  provider: MockProvider;
};

export async function createMockHarness(options: MockHarnessOptions = {}): Promise<MockHarness> {
  const seedFixtures = options.seedFixtures ?? true;
  const provider = createMockProvider();

  const fixtures = seedFixtures ? await seedAllFixtures(provider) : undefined;

  return {
    label: 'mock',
    provider,
    setup: {
      async createSubscription({ customerId, priceId, quantity }) {
        return provider.admin.createSubscription({
          customerId,
          priceId,
          ...(quantity !== undefined ? { quantity } : {}),
        });
      },
      async completePurchase({ checkoutSessionId }) {
        return provider.admin.completePurchase({ checkoutSessionId });
      },
    },
    ...(fixtures ? { fixtures } : {}),
  };
}

async function seedAllFixtures(
  provider: MockProvider,
): Promise<NonNullable<MockHarness['fixtures']>> {
  const customer = await provider.customers.create({ email: 'fixture@mock.test' });
  const product = await provider.products.create({
    name: 'fixture-product',
    taxCategory: 'saas',
  });
  // Two recurring prices: `recurringPrice` is the fixture-exposed swap target;
  // `subscriptionPrice` is what the seeded subscription actually rides on. The
  // subscriptions fixture suite skips the price-change scenario when the
  // subscription is already on the swap target, so they must differ for the
  // scenario to exercise the scheduled-price-change path.
  const recurringPrice = await provider.prices.create({
    productId: product.id,
    currency: 'usd',
    kind: 'recurring',
    unitAmount: 999,
    interval: 'month',
    intervalCount: 1,
  });
  const subscriptionPrice = await provider.prices.create({
    productId: product.id,
    currency: 'usd',
    kind: 'recurring',
    unitAmount: 1499,
    interval: 'month',
    intervalCount: 1,
  });
  const oneTimePrice = await provider.prices.create({
    productId: product.id,
    currency: 'usd',
    kind: 'one_time',
    unitAmount: 4999,
  });
  const subscription = provider.admin.createSubscription({
    customerId: customer.id,
    priceId: subscriptionPrice.id,
  });
  const discount = await provider.discounts.create({
    benefit: { kind: 'percent', percentOff: 10 },
    duration: { kind: 'once' },
  });
  const webhook = await provider.webhooks.createEndpoint({
    url: 'https://example.com/hook-fixture',
    eventTypes: ['customer.created', 'subscription.updated'],
  });
  return {
    customerId: customer.id,
    productId: product.id,
    recurringPriceId: recurringPrice.id,
    oneTimePriceId: oneTimePrice.id,
    subscriptionId: subscription.id,
    discountId: discount.id,
    webhookEndpointId: webhook.id,
  };
}
