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
}
