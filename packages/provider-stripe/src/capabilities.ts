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
 * Normalized event types that Stripe webhook endpoints can subscribe to.
 *
 * Hand-maintained alongside `STRIPE_TO_NORMALIZED_EVENT` in
 * `normalize/event.ts`: every entry here corresponds to at least one Stripe
 * source event that maps into the normalized contract. Adding a new entry
 * here without a matching entry in that map would let `webhooks.createEndpoint`
 * accept a subscription that can never fire — keep them in sync.
 *
 * Intentionally excluded:
 *   - `subscription.trial_ended`: Stripe doesn't emit it. Consumers wanting
 *     trial-ended detection diff status across `subscription.updated`.
 *   - `payment.created`: Stripe doesn't have a "charge was created" event.
 *   - `discount.archived`: PromotionCodes are deactivated, not archived; the
 *     SDK maps that to `discount.updated`.
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
  'payment.succeeded',
  'payment.failed',
  'payment.refunded',
  'discount.created',
  'discount.updated',
  'checkout_session.completed',
  'checkout_session.expired',
  'billing_document.finalized',
]);

/**
 * Stripe accepts trials in days only (`trial_period_days`). `day` and `week`
 * convert exactly to an integer day count; `month`/`year` have no fixed-day
 * equivalent, so they are rejected via `ProviderNotSupportedError` rather than
 * silently approximated. See `trial-translation.ts`.
 */
const TRIAL_UNITS: ReadonlySet<RecurringInterval> = new Set<RecurringInterval>(['day', 'week']);

/** Stripe accepts all four recurring intervals on a recurring price. */
const RECURRING_INTERVALS: ReadonlySet<RecurringInterval> = new Set<RecurringInterval>([
  'day',
  'week',
  'month',
  'year',
]);

/**
 * Stripe behavioral flags.
 *
 * - `priceQuantityConstraints: false` — Stripe has no native price-level
 *   quantity constraint; enforcing it at checkout would cost an N+1
 *   per-line-item `prices.retrieve`. The constraint still round-trips on
 *   `ProviderPrice.quantity`; the consumer enforces it from persistence.
 * - `discountProductRestrictions: true` — enforced natively via
 *   `coupon.applies_to.products` (zero extra round-trips).
 * - `discountPriceRestrictions: false` — Stripe has no native price-scoped
 *   restriction; the value round-trips but is not enforced by the adapter.
 */
const FEATURES: ProviderFeatureFlags = {
  priceQuantityConstraints: false,
  discountProductRestrictions: true,
  discountPriceRestrictions: false,
};

export const STRIPE_CAPABILITIES: ProviderCapabilities = {
  taxCategories: TAX_CATEGORIES,
  currencies: CURRENCIES,
  webhookEventTypes: WEBHOOK_EVENT_TYPES,
  trialUnits: TRIAL_UNITS,
  recurringIntervals: RECURRING_INTERVALS,
  // Stripe models recurrence on the Price.
  recurrenceModel: 'price',
  features: FEATURES,
};
