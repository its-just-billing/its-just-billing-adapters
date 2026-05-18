import type { ProviderTestHarness } from '@its-just-billing/provider-sdk/conformance';
import { type MockCheckoutPresentation, type MockProvider, createMockProvider } from './index.js';

/**
 * Build a fresh conformance harness backed by an in-memory mock provider.
 *
 * The mock can self-create subscriptions and complete payments, so both
 * `setup.createSubscription` and `setup.completePayment` are provided. When
 * `seedFixtures` is true (the default) the harness pre-provisions the one
 * resource the fixture suite needs — a subscription — so the mock serves as
 * the reference for the subscription fixture scenarios. (Every other resource
 * is SDK-creatable and exercised by the automated/self-setup suites.)
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
      async createSubscription({ customerId, priceId, quantity, trial }) {
        return provider.admin.createSubscription({
          customerId,
          priceId,
          ...(quantity !== undefined ? { quantity } : {}),
          ...(trial !== undefined ? { trial } : {}),
        });
      },
      async completePayment({ checkoutSessionId }) {
        return provider.admin.completePayment({ checkoutSessionId });
      },
    },
    ...(fixtures ? { fixtures } : {}),
  };
}

async function seedAllFixtures(
  provider: MockProvider,
): Promise<NonNullable<MockHarness['fixtures']>> {
  // The only pre-provisioned fixture resource is a subscription. The customer
  // and price exist solely to create it (the SDK can't create a subscription
  // without a checkout — that's the whole reason this is a fixture). The
  // subscription fixture suite creates its own swap-target price at test time.
  const customer = await provider.customers.create({ email: 'fixture@mock.test' });
  const product = await provider.products.create({
    name: 'fixture-product',
    taxCategory: 'saas',
  });
  const subscriptionPrice = await provider.prices.create({
    productId: product.id,
    currency: 'usd',
    kind: 'recurring',
    unitAmount: 1499,
    interval: 'month',
    intervalCount: 1,
  });
  const subscription = provider.admin.createSubscription({
    customerId: customer.id,
    priceId: subscriptionPrice.id,
  });
  return { subscriptionId: subscription.id };
}
