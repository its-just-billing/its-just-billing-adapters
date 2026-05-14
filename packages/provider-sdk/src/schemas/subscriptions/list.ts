import { z } from '../../zod.js';
import { ProviderSubscriptionSchema, SubscriptionStatusSchema } from '../../models/subscription.js';
import { pageOf } from '../../models/page.js';
import { PaginationInputSchema } from '../pagination.js';

export const SubscriptionsListInputSchema = PaginationInputSchema.extend({
  customerId: z.string().min(1),
  status: SubscriptionStatusSchema.optional(),
}).openapi('SubscriptionsListInput');

export const SubscriptionsListOutputSchema = pageOf(
  ProviderSubscriptionSchema,
  'SubscriptionsPage',
);

export type SubscriptionsListInput = z.infer<typeof SubscriptionsListInputSchema>;
export type SubscriptionsListOutput = z.infer<typeof SubscriptionsListOutputSchema>;
