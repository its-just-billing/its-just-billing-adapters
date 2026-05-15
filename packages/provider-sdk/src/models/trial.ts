import { z } from '../zod.js';
import { RecurringIntervalSchema } from './price.js';

/**
 * Trial-period specification accepted on `checkout.createSession({ trial })`.
 * Uses the same interval enum as `RecurringInterval` so a 14-day trial reads
 * `{ count: 14, unit: 'day' }` and a 2-week trial reads `{ count: 2, unit:
 * 'week' }`.
 *
 * Adapters translate this to their native trial parameter. Stripe accepts
 * only day-level trials (`trial_period_days`), so it converts day/week and
 * rejects month/year with `ProviderNotSupportedError`. Polar accepts all four
 * units natively. The mock honors all four via calendar math.
 */
export const TrialSpecSchema = z
  .object({
    count: z.number().int().positive(),
    unit: RecurringIntervalSchema,
  })
  .strict()
  .openapi('TrialSpec', {
    description:
      'A trial period offered on a checkout session. Interpreted as `count` × `unit` from the moment the resulting subscription starts.',
  });

export type TrialSpec = z.infer<typeof TrialSpecSchema>;
