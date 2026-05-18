import type {
  ProviderCapabilities,
  ProviderEventType,
  ProviderFeatureFlags,
  RecurringInterval,
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

/** The mock honors trials in any normalized unit (no day-only constraint). */
const TRIAL_UNITS: ReadonlySet<RecurringInterval> = new Set<RecurringInterval>([
  'day',
  'week',
  'month',
  'year',
]);

/** The mock accepts every normalized recurring interval. */
const RECURRING_INTERVALS: ReadonlySet<RecurringInterval> = new Set<RecurringInterval>([
  'day',
  'week',
  'month',
  'year',
]);

/**
 * The mock turns on every behavioral flag it can so the conformance harness
 * exercises the *on* branches that Stripe (a no-price-restriction provider)
 * leaves off. `recurrenceModel` stays `'price'`: the mock models recurrence
 * on the price like Stripe/Paddle.
 */
const FEATURES: ProviderFeatureFlags = {
  priceQuantityConstraints: true,
  discountProductRestrictions: true,
  discountPriceRestrictions: true,
};

export const MOCK_CAPABILITIES: ProviderCapabilities = {
  taxCategories: TAX_CATEGORIES,
  currencies: CURRENCIES,
  webhookEventTypes: WEBHOOK_EVENT_TYPES,
  trialUnits: TRIAL_UNITS,
  recurringIntervals: RECURRING_INTERVALS,
  recurrenceModel: 'price',
  features: FEATURES,
};
