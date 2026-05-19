import type { TrialSpec } from '@its-just-billing/provider-sdk';
import type { Interval } from '@paddle/paddle-node-sdk';

/**
 * Translate the SDK's `TrialSpec` into a Paddle trial-period duration
 * (`{ interval, frequency }`). Unlike Stripe (day-only `trial_period_days`),
 * Paddle accepts all four interval units natively, so every `TrialSpec` maps
 * 1:1 with no approximation and no `ProviderNotSupportedError` — Paddle's
 * `trialUnits` capability advertises the full `day|week|month|year` set.
 *
 * Paddle models trials on the *price* (`price.trialPeriod`), so this is used
 * when materializing the trial onto the price/transaction a checkout drives;
 * the SDK's checkout-level trial axis is layered on top of that (see the
 * dual capability-axis resolution in `docs/handoff.md`).
 */
export function trialToPaddleDuration(trial: TrialSpec): {
  interval: Interval;
  frequency: number;
} {
  return { interval: trial.unit, frequency: trial.count };
}
