import { z } from '../../zod.js';
import {
  ProviderSubscriptionSchema,
  type ProviderSubscription,
} from '../../models/subscription.js';

export const SubscriptionsGetInputSchema = z
  .object({ id: z.string().min(1) })
  .openapi('SubscriptionsGetInput');

export const SubscriptionsGetOutputSchema = ProviderSubscriptionSchema.nullable();

export type SubscriptionsGetInput = z.infer<typeof SubscriptionsGetInputSchema>;
export type SubscriptionsGetOutput<TRaw = unknown> = ProviderSubscription<TRaw> | null;
