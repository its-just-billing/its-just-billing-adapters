import { z } from '../../zod.js';
import {
  ProviderSubscriptionSchema,
  SubscriptionStatusSchema,
  type ProviderSubscription,
} from '../../models/subscription.js';
import { pageOf, type Page } from '../../models/page.js';
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
export type SubscriptionsListOutput<TRaw = unknown> = Page<ProviderSubscription<TRaw>>;
