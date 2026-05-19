import type {
  ProviderCapabilities,
  ProviderEventType,
  ProviderFeatureFlags,
  RecurringInterval,
  TaxCategory,
} from '@its-just-billing/provider-sdk';

/**
 * Every SDK tax category maps 1:1 to a Paddle native category (the SDK enum
 * is explicitly aligned with Paddle's set — see `tax-codes.ts`).
 */
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

/**
 * Paddle Billing's supported currency set, lowercased to the SDK's ISO-4217
 * convention. Source: Paddle SDK `CurrencyCode` enum (v3). Cross-check
 * against the live sandbox when first wiring against an account.
 */
const CURRENCIES: ReadonlySet<string> = new Set<string>([
  'usd',
  'eur',
  'gbp',
  'jpy',
  'aud',
  'cad',
  'chf',
  'clp',
  'hkd',
  'sgd',
  'sek',
  'ars',
  'brl',
  'cny',
  'cop',
  'czk',
  'dkk',
  'huf',
  'ils',
  'inr',
  'krw',
  'mxn',
  'nok',
  'nzd',
  'pen',
  'pln',
  'rub',
  'thb',
  'try',
  'twd',
  'uah',
  'vnd',
  'zar',
]);

/**
 * Normalized event types Paddle webhook destinations can subscribe to. Every
 * entry MUST have a matching Paddle source event in `normalize/event.ts`'s
 * `PADDLE_TO_NORMALIZED_EVENT` — keep the two lists in sync (same invariant
 * Stripe documents on its `WEBHOOK_EVENT_TYPES`).
 *
 * Intentionally excluded (no Paddle source event in v1):
 *   - `customer.deleted` — Paddle archives customers (a `customer.updated`),
 *     it never deletes them.
 *   - `subscription.trial_will_end` / `subscription.trial_ended` — Paddle has
 *     no dedicated trial-boundary event; consumers diff `subscription.updated`.
 *   - `discount.archived` — Paddle emits `discount.updated` on archive.
 *   - `checkout_session.*` — Paddle has no checkout-session object/events.
 *   - `billing_document.finalized` — no dedicated Paddle event.
 */
const WEBHOOK_EVENT_TYPES: ReadonlySet<ProviderEventType> = new Set<ProviderEventType>([
  'customer.created',
  'customer.updated',
  'product.created',
  'product.updated',
  'price.created',
  'price.updated',
  'subscription.created',
  'subscription.updated',
  'subscription.canceled',
  'payment.created',
  'payment.succeeded',
  'payment.failed',
  'payment.refunded',
  'discount.created',
  'discount.updated',
]);

/**
 * Paddle accepts all four interval units on a recurring price's billing cycle
 * (`Interval = 'day'|'week'|'month'|'year'`).
 */
const RECURRING_INTERVALS: ReadonlySet<RecurringInterval> = new Set<RecurringInterval>([
  'day',
  'week',
  'month',
  'year',
]);

/**
 * Paddle's trial period is a `{ interval, frequency }` duration over the same
 * interval set, so unlike Stripe (day-only) every `TrialSpec` unit maps
 * natively — see `trial-translation.ts`.
 */
const TRIAL_UNITS: ReadonlySet<RecurringInterval> = new Set<RecurringInterval>([
  'day',
  'week',
  'month',
  'year',
]);

/**
 * Paddle behavioral flags.
 *
 * - `priceQuantityConstraints: true` — Paddle prices carry a native
 *   `quantity.{minimum,maximum}` enforced at checkout/subscription change,
 *   so the adapter relies on it (no extra round-trip), unlike Stripe.
 * - `discountProductRestrictions: false` / `discountPriceRestrictions: false`
 *   — Paddle's native `restrict_to` existence-validates its ids against the
 *   `^(pri|pro)_[a-z0-9]{26}$` shape and rejects unknown ones, but the SDK
 *   contract round-trips an arbitrary `restrictedTo` unchanged. So the
 *   adapter does not use `restrict_to`; it round-trips the value through
 *   managed `customData` instead (consumer-owned, not natively enforced),
 *   exactly like the Stripe adapter's price-restriction path.
 */
const FEATURES: ProviderFeatureFlags = {
  priceQuantityConstraints: true,
  discountProductRestrictions: false,
  discountPriceRestrictions: false,
};

export const PADDLE_CAPABILITIES: ProviderCapabilities = {
  taxCategories: TAX_CATEGORIES,
  currencies: CURRENCIES,
  webhookEventTypes: WEBHOOK_EVENT_TYPES,
  trialUnits: TRIAL_UNITS,
  recurringIntervals: RECURRING_INTERVALS,
  // Paddle models recurrence on the Price (billing cycle), like Stripe.
  recurrenceModel: 'price',
  features: FEATURES,
  // Paddle mandates a non-null customer email — the adapter rejects a missing
  // one rather than fabricating a dead address.
  emailRequired: true,
  // Paddle enforces this on a discount's redemption code; the caller's code
  // is sent to Paddle verbatim, and one outside this shape is rejected (not
  // silently round-tripped, which would never redeem at Paddle).
  discountCodePattern: /^[A-Za-z0-9]{1,32}$/,
  // Paddle has no codeless discount — it auto-assigns a (real, redeemable)
  // code when the caller supplies none, surfaced as-is rather than faked to
  // null.
  discountCodeRequired: true,
  // Paddle has no checkout-level trial: trials live on the price
  // (`price.trialPeriod`), and a catalog-priced transaction carries no trial
  // override. `checkout.createSession({ trial })` rejects rather than
  // silently dropping it; `trialUnits` above stays the trial-unit value set.
  checkoutTrialSupported: false,
  // Paddle's `scheduled_change` is cancel/pause/resume only — there is no
  // deferred item/quantity change, so `subscriptions.change` can only apply
  // immediately. `when: 'at_period_end'` is rejected, not silently applied
  // now (which would alter the subscription before the period ends).
  deferredSubscriptionChange: false,
};
