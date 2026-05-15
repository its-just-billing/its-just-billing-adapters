import type { ProviderEventType } from './event.js';
import type { TaxCategory } from './tax-category.js';

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
}
