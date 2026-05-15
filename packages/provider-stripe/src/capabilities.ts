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

export const STRIPE_CAPABILITIES: ProviderCapabilities = {
  taxCategories: TAX_CATEGORIES,
  currencies: CURRENCIES,
  webhookEventTypes: WEBHOOK_EVENT_TYPES,
};
