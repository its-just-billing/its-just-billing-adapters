import { z } from '../../zod.js';
import { ProviderSubscriptionSchema } from '../../models/subscription.js';

export const SubscriptionsGetInputSchema = z
  .object({ id: z.string().min(1) })
  .openapi('SubscriptionsGetInput');

export const SubscriptionsGetOutputSchema = ProviderSubscriptionSchema.nullable();

export type SubscriptionsGetInput = z.infer<typeof SubscriptionsGetInputSchema>;
export type SubscriptionsGetOutput = z.infer<typeof SubscriptionsGetOutputSchema>;
