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
}
