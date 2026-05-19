import { ProviderNotSupportedError } from '../errors/not-supported.js';

/**
 * Hard value-set gate. Throws `ProviderNotSupportedError` (422,
 * `not_supported`) when `value` is outside the provider's declared set for a
 * capability axis (e.g. trial units, currencies). Mirrors the existing
 * inline `capabilities.<axis>.has(value)` pattern; centralized so every gate
 * produces a consistent `feature`/`value` error shape.
 *
 * `feature` is the capability axis name (e.g. `'trial.unit'`); `label` is the
 * method label for the message (e.g. `'checkout.createSession'`).
 */
export function assertCapabilityValueSupported<T>(
  set: ReadonlySet<T>,
  value: T,
  feature: string,
  label: string,
): void {
  if (set.has(value)) return;
  throw new ProviderNotSupportedError({
    feature,
    value,
    message: `${label}: provider does not support ${feature}=${String(value)}`,
  });
}

/**
 * Hard boolean feature gate. Throws `ProviderNotSupportedError` when a
 * structural capability is disabled but the caller supplied input that
 * depends on it (e.g. a recurrence block on `products.create` against a
 * price-level-recurrence provider).
 *
 * This is for the *reject* case. The "accept + persist but do not apply"
 * behavior (price quantity constraints) is deliberately NOT modeled here — it
 * is the absence of an enforcement call, conditioned on the flag, not a guard.
 */
export function assertFeatureEnabled(enabled: boolean, feature: string, label: string): void {
  if (enabled) return;
  throw new ProviderNotSupportedError({
    feature,
    value: false,
    message: `${label}: provider does not support ${feature}`,
  });
}
