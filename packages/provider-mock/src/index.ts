import type { BillingProvider } from '@its-just-billing/provider-sdk';
import { type MockAdmin, createMockAdmin } from './admin.js';
import { MOCK_CAPABILITIES } from './capabilities.js';
import { createCheckoutDomain } from './domains/checkout.js';
import { createCustomersDomain } from './domains/customers.js';
import { createDiscountsDomain } from './domains/discounts.js';
import { createEventsDomain } from './domains/events.js';
import { createPricesDomain } from './domains/prices.js';
import { createProductsDomain } from './domains/products.js';
import { createPurchasesDomain } from './domains/purchases.js';
import { createSubscriptionsDomain } from './domains/subscriptions.js';
import { createWebhooksDomain } from './domains/webhooks.js';
import type { MockCheckoutPresentation } from './presentation.js';
import { MockState } from './state.js';
import { signMockWebhook } from './webhook-signing.js';

export type { MockCheckoutPresentation };
export { MockState };
export { signMockWebhook };
export type { MockAdmin };

export interface MockProvider extends BillingProvider<MockCheckoutPresentation> {
  readonly raw: MockState;
  readonly admin: MockAdmin;
}

export function createMockProvider(): MockProvider {
  const state = new MockState();
  return {
    providerId: 'mock',
    capabilities: MOCK_CAPABILITIES,
    customers: createCustomersDomain(state),
    products: createProductsDomain(state, MOCK_CAPABILITIES),
    prices: createPricesDomain(state, MOCK_CAPABILITIES),
    subscriptions: createSubscriptionsDomain(state),
    checkout: createCheckoutDomain(state),
    purchases: createPurchasesDomain(state),
    discounts: createDiscountsDomain(state),
    events: createEventsDomain(state),
    webhooks: createWebhooksDomain(state),
    raw: state,
    admin: createMockAdmin(state),
  };
}
