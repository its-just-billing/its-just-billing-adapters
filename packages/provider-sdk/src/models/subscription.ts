import { z } from '../zod.js';
import { MetadataSchema } from './metadata.js';

export const SubscriptionStatusSchema = z.enum([
  'trialing',
  'active',
  'past_due',
  'unpaid',
  'canceled',
  'incomplete',
  'incomplete_expired',
]);
export type SubscriptionStatus = z.infer<typeof SubscriptionStatusSchema>;

export const SubscriptionItemSchema = z.object({
  id: z.string().min(1),
  priceId: z.string().min(1),
  quantity: z.number().int().positive(),
});
export type SubscriptionItem = z.infer<typeof SubscriptionItemSchema>;

export const PendingSubscriptionChangeSchema = z
  .object({
    kind: z.enum(['price_change', 'cancel']),
    items: z.array(SubscriptionItemSchema).optional(),
    effectiveAt: z.date(),
  })
  .openapi('PendingSubscriptionChange', {
    description: 'A change scheduled to apply at period end. Null if no change is pending.',
  });
export type PendingSubscriptionChange = z.infer<typeof PendingSubscriptionChangeSchema>;

export const ProviderSubscriptionSchema = z
  .object({
    id: z.string().min(1),
    customerId: z.string().min(1),
    status: SubscriptionStatusSchema,
    items: z.array(SubscriptionItemSchema).min(1),
    currentPeriodStart: z.date(),
    currentPeriodEnd: z.date(),
    cancelAtPeriodEnd: z.boolean(),
    canceledAt: z.date().nullable(),
    pendingChange: PendingSubscriptionChangeSchema.nullable(),
    metadata: MetadataSchema,
    createdAt: z.date(),
  })
  .openapi('ProviderSubscription', {
    description:
      'Normalized subscription. Pause/resume are intentionally not modeled — use the raw provider client if needed.',
  });

export type ProviderSubscription = z.infer<typeof ProviderSubscriptionSchema>;
