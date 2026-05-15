import { z } from '../../zod.js';
import {
  ProviderSubscriptionSchema,
  type ProviderSubscription,
} from '../../models/subscription.js';

export const SubscriptionsCancelScheduledChangeInputSchema = z
  .object({ id: z.string().min(1) })
  .openapi('SubscriptionsCancelScheduledChangeInput');

export const SubscriptionsCancelScheduledChangeOutputSchema = ProviderSubscriptionSchema;

export type SubscriptionsCancelScheduledChangeInput = z.infer<
  typeof SubscriptionsCancelScheduledChangeInputSchema
>;
export type SubscriptionsCancelScheduledChangeOutput<TRaw = unknown> = ProviderSubscription<TRaw>;
