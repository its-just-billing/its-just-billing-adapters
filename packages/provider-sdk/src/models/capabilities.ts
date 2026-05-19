import type { ProviderEventType } from './event.js';
import type { RecurringInterval } from './price.js';
import type { TaxCategory } from './tax-category.js';

/**
 * Where billing recurrence lives in a provider's model. Mutually exclusive —
 * a single discriminated value, not two booleans, so illegal states ("both"
 * / "neither") are unrepresentable.
 *
 *  - `'price'`  — recurrence is a property of the price (Stripe, Paddle).
 *    `prices.create` accepts the recurring `kind`; `products.create` rejects a
 *    `recurrence` block.
 *  - `'product'` — recurrence is a property of the product (Polar, future).
 *    `products.create` accepts a `recurrence` block; `prices.create` rejects
 *    the recurring `kind`.
 */
export type RecurrenceModel = 'price' | 'product';

/**
 * Structural / behavioral capability flags. Booleans (not a string→bool map)
 * so TypeScript forces every adapter to declare each flag explicitly — a new
 * provider can't silently inherit a default.
 *
 * The discriminator for whether a behavior is mimicked by the adapter or
 * pushed out to the consumer via one of these flags is **round-trip cost**:
 * the adapter mimics only what the provider enforces natively with zero extra
 * round-trips. The moment honoring a behavior would cost N fetches, or the
 * provider has no native mechanism, it becomes a flag and the consumer (which
 * holds the data in its own persistence) enforces it.
 */
export interface ProviderFeatureFlags {
  /**
   * Adapter enforces price quantity constraints at checkout / subscription
   * change. `false` → the constraint is still persisted on
   * `ProviderPrice.quantity` and round-trips faithfully, but the adapter does
   * not validate it at checkout (the consumer enforces it from persistence —
   * avoiding an N+1 per-line-item price fetch).
   */
  readonly priceQuantityConstraints: boolean;
  /** Provider natively enforces product-scoped discount restriction. */
  readonly discountProductRestrictions: boolean;
  /** Provider natively enforces price-scoped discount restriction. */
  readonly discountPriceRestrictions: boolean;
}

/**
 * Static per-provider capability inventory for cross-provider value-set gaps.
 *
 * Exposed as `BillingProvider.capabilities` so callers can pre-flight checks
 * (e.g., "does this provider support the chosen currency?") and render
 * settings UIs without learning provider-native field names. Adapters compute
 * this at construction; there is no async population.
 *
 * Only axes with real cross-provider divergence are modeled. Adding a new
 * axis is a deliberate contract change — this is not a kitchen-sink feature
 * flag bag.
 *
 * Pre-flight via `capabilities` is the ergonomic path. The defense at call
 * time is `ProviderNotSupportedError` (status 422, code 'not_supported'),
 * which fires when the active provider can't honor a normalized value.
 */
export interface ProviderCapabilities {
  /** Tax categories the adapter can accept on `products.create`. */
  readonly taxCategories: ReadonlySet<TaxCategory>;
  /** Currencies (lowercase ISO 4217) the adapter accepts on `prices.create`. */
  readonly currencies: ReadonlySet<string>;
  /**
   * Normalized event types this provider's webhook endpoints can subscribe
   * to. `webhooks.createEndpoint` and `webhooks.updateEndpoint` reject
   * eventTypes outside this set with `ProviderNotSupportedError(422)`.
   *
   * Per-adapter inventory: adapters list exactly the normalized types they
   * have a native source event for. Combined with the events domain's
   * "filter to known types" behavior, this keeps webhook subscriptions
   * honest — callers can't silently accept an event type that the provider
   * will never fire.
   *
   * Pre-flight via this set is the ergonomic path for callers building
   * settings UIs ("which events can this account subscribe to?").
   */
  readonly webhookEventTypes: ReadonlySet<ProviderEventType>;
  /**
   * Trial billing-interval units the adapter can honor. Stripe accepts trials
   * in days only, so it advertises `{ 'day', 'week' }` (week is exact in
   * days); `month`/`year` have no fixed-day equivalent and are rejected via
   * `ProviderNotSupportedError`. Pre-flight: `capabilities.trialUnits.has(u)`.
   */
  readonly trialUnits: ReadonlySet<RecurringInterval>;
  /**
   * Recurring billing intervals the adapter accepts on a recurring price
   * (symmetric to {@link trialUnits}). A recurring `prices.create` with an
   * interval outside this set is rejected with `ProviderNotSupportedError`
   * (422, feature `price.interval`). Pre-flight:
   * `capabilities.recurringIntervals.has(interval)`.
   */
  readonly recurringIntervals: ReadonlySet<RecurringInterval>;
  /**
   * Where recurrence lives in this provider's model. See
   * {@link RecurrenceModel}. Replaces the former
   * `features.priceLevelRecurrence` / `features.productLevelRecurrence`
   * boolean pair (mutually exclusive — one discriminated value).
   */
  readonly recurrenceModel: RecurrenceModel;
  /** Structural / behavioral feature flags. See {@link ProviderFeatureFlags}. */
  readonly features: ProviderFeatureFlags;
  /**
   * The provider mandates a non-null customer email (Paddle does; Stripe and
   * the mock do not). When `true`, `customers.create`/`customers.update` with
   * no email reject with `ProviderNotSupportedError(422)` rather than the
   * adapter fabricating a placeholder — a fabricated email would be a real
   * production footgun (receipts/dunning sent to a dead address). Absent or
   * `false` ⇒ email is optional and a customer round-trips `email: null`.
   *
   * A value-gate like {@link currencies}/{@link taxCategories} — it does not
   * change request/response *shape*, so by the same rule it is intentionally
   * NOT part of the capability profile fragment.
   */
  readonly emailRequired?: boolean;
  /**
   * Constraint a provider enforces on a discount's redemption `code`. Paddle
   * requires `^[A-Za-z0-9]{1,32}$`; Stripe/the mock are permissive (omit).
   * The caller's code is sent to the provider verbatim — it must actually
   * redeem there, so it is NOT round-tripped through metadata; a code outside
   * this pattern rejects with `ProviderNotSupportedError(422)`. Pre-flight:
   * `capabilities.discountCodePattern?.test(code)`.
   *
   * Also a value-gate — excluded from the capability profile fragment.
   */
  readonly discountCodePattern?: RegExp;
  /**
   * The provider cannot represent a *codeless* discount — every discount is
   * assigned a redemption code (Paddle auto-generates one when the caller
   * supplies none; Stripe/the mock create a code-less coupon, so they omit
   * this). When `true`, a discount created without a caller code comes back
   * with a provider-assigned, non-null `code` (a real, redeemable value —
   * surfaced honestly, not hidden behind `null`); when absent/`false`, an
   * omitted code round-trips as `code: null`. A value-gate — excluded from
   * the capability profile fragment.
   */
  readonly discountCodeRequired?: boolean;
  /**
   * The provider can apply a checkout-session trial (`checkout.createSession`
   * `{ trial }`). Absent/`true` ⇒ supported, and every unit in
   * {@link trialUnits} must be honored by `checkout.createSession` (not
   * rejected). `false` ⇒ the provider has no checkout-level trial mechanism
   * (Paddle models trials on the *price*, not the checkout transaction), so
   * `checkout.createSession({ trial })` rejects with
   * `ProviderNotSupportedError(feature: 'checkout.trial')` — preflight with
   * this flag, not {@link trialUnits}, before sending a checkout trial.
   * {@link trialUnits} remains the (non-empty) trial-unit value set
   * regardless. A value-gate — excluded from the capability profile fragment.
   */
  readonly checkoutTrialSupported?: boolean;
  /**
   * The provider can defer a `subscriptions.change` to period end
   * (`when: 'at_period_end'`), surfacing it as a `pendingChange` until it
   * takes effect. Absent/`true` ⇒ supported. `false` ⇒ the provider can only
   * apply item/quantity changes immediately (Paddle: its `scheduled_change`
   * is cancel/pause/resume only — there is no deferred item change), so
   * `subscriptions.change({ when: 'at_period_end' })` rejects with
   * `ProviderNotSupportedError(feature: 'subscription.change.when')` rather
   * than silently applying the change immediately. A value-gate — excluded
   * from the capability profile fragment.
   */
  readonly deferredSubscriptionChange?: boolean;
}
