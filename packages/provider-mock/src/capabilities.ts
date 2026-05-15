import type {
  ProviderCapabilities,
  ProviderEventType,
  TaxCategory,
} from '@its-just-billing/provider-sdk';

const TAX_CATEGORIES: ReadonlySet<TaxCategory> = new Set<TaxCategory>([
  'digital_goods',
  'ebooks',
  'implementation_services',
  'professional_services',
  'saas',
  'software_programming_services',
  'standard',
  'training_services',
  'website_hosting',
]);

const CURRENCIES: ReadonlySet<string> = new Set<string>([
  'usd',
  'eur',
  'gbp',
  'jpy',
  'cad',
  'aud',
  'chf',
  'cny',
  'inr',
  'brl',
  'sek',
  'nok',
  'dkk',
  'sgd',
  'hkd',
  'nzd',
  'mxn',
  'zar',
  'krw',
  'twd',
  'thb',
  'pln',
  'czk',
  'huf',
  'ils',
  'aed',
  'sar',
  'ron',
  'try',
  'ars',
  'clp',
  'cop',
  'pen',
]);

/**
 * The mock emits every normalized event type via its in-memory event ring
 * buffer (admin affordances cover the ones real providers can't trigger on
 * demand, e.g. `subscription.trial_ended` via `MockAdmin.endTrial`).
 */
const WEBHOOK_EVENT_TYPES: ReadonlySet<ProviderEventType> = new Set<ProviderEventType>([
  'customer.created',
  'customer.updated',
  'customer.deleted',
  'product.created',
  'product.updated',
  'price.created',
  'price.updated',
  'subscription.created',
  'subscription.updated',
  'subscription.canceled',
  'subscription.trial_will_end',
  'subscription.trial_ended',
  'payment.created',
  'payment.succeeded',
  'payment.failed',
  'payment.refunded',
  'discount.created',
  'discount.updated',
  'discount.archived',
  'checkout_session.completed',
  'checkout_session.expired',
  'billing_document.finalized',
]);

export const MOCK_CAPABILITIES: ProviderCapabilities = {
  taxCategories: TAX_CATEGORIES,
  currencies: CURRENCIES,
  webhookEventTypes: WEBHOOK_EVENT_TYPES,
};
