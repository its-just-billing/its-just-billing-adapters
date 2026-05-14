import { z } from '../../zod.js';
import { ProviderSubscriptionSchema } from '../../models/subscription.js';

export const SubscriptionsCancelInputSchema = z
  .object({
    id: z.string().min(1),
    when: z.enum(['immediately', 'at_period_end']).default('at_period_end'),
  })
  .openapi('SubscriptionsCancelInput', {
    description:
      'Cancel a subscription. `at_period_end` schedules the cancellation; `immediately` ends the subscription now.',
  });

export const SubscriptionsCancelOutputSchema = ProviderSubscriptionSchema;

export type SubscriptionsCancelInput = z.infer<typeof SubscriptionsCancelInputSchema>;
export type SubscriptionsCancelOutput = z.infer<typeof SubscriptionsCancelOutputSchema>;
