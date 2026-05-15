import {
  ProviderConstraintError,
  ProviderNotSupportedError,
  type TrialSpec,
} from '@its-just-billing/provider-sdk';

/**
 * Translate the SDK's `TrialSpec` into Stripe's `trial_period_days` (the only
 * trial knob Stripe accepts). `day` and `week` map cleanly; `month`/`year`
 * have no fixed-day equivalent (months are 28-31 days, years are 365-366) so
 * we reject with `ProviderNotSupportedError` rather than silently
 * approximating. Polar will accept all four units natively.
 *
 * Stripe caps `trial_period_days` at 730 (about 2 years); requests beyond
 * that surface as `ProviderConstraintError` before the API call.
 *
 * Shared between `checkout.createSession` (public surface) and the
 * conformance harness's `setup.createSubscription` (test surface) so both
 * paths honor the same translation rules — the harness must not silently
 * approximate, or `trialEnd` round-trips lie.
 */
export function trialToStripeDays(trial: TrialSpec): number {
  let days: number;
  switch (trial.unit) {
    case 'day':
      days = trial.count;
      break;
    case 'week':
      days = trial.count * 7;
      break;
    case 'month':
    case 'year':
      throw new ProviderNotSupportedError({
        feature: 'trial.unit',
        value: trial.unit,
        message: `Stripe accepts trials in days only; convert ${trial.count} ${trial.unit}(s) to an explicit day count or use Polar.`,
      });
  }
  if (days > 730) {
    throw new ProviderConstraintError({
      message: `Stripe rejects trial_period_days above 730 (requested ${days})`,
      details: { requested: days, max: 730 },
    });
  }
  return days;
}
