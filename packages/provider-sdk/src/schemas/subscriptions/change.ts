import { z } from '../../zod.js';
import {
  ProviderSubscriptionSchema,
  type ProviderSubscription,
} from '../../models/subscription.js';

const ChangeItem = z.object({
  priceId: z.string().min(1),
  quantity: z.number().int().positive().optional(),
});

export const SubscriptionsChangeInputSchema = z
  .object({
    id: z.string().min(1),
    items: z.array(ChangeItem).min(1),
    when: z.enum(['immediately', 'at_period_end']).default('immediately'),
    prorationBehavior: z.enum(['create_prorations', 'none']).default('create_prorations'),
  })
  .openapi('SubscriptionsChangeInput', {
    description:
      'Change price and/or quantity on a subscription. Items replace the current set entirely.',
  });

export const SubscriptionsChangeOutputSchema = ProviderSubscriptionSchema;

export type SubscriptionsChangeInput = z.infer<typeof SubscriptionsChangeInputSchema>;
export type SubscriptionsChangeOutput<TRaw = unknown> = ProviderSubscription<TRaw>;
