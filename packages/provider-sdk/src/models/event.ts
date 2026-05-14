import { z } from '../zod.js';

export const EventResourceKindSchema = z.enum([
  'customer',
  'product',
  'price',
  'subscription',
  'purchase',
  'discount',
  'checkout_session',
  'billing_document',
]);
export type EventResourceKind = z.infer<typeof EventResourceKindSchema>;

export const ProviderEventTypeSchema = z.enum([
  'customer.created',
  'customer.updated',
  'customer.deleted',
  'product.created',
  'product.updated',
  'product.archived',
  'price.created',
  'price.updated',
  'price.archived',
  'subscription.created',
  'subscription.updated',
  'subscription.canceled',
  'purchase.created',
  'purchase.succeeded',
  'purchase.failed',
  'purchase.refunded',
  'discount.created',
  'discount.updated',
  'discount.archived',
  'checkout_session.completed',
  'checkout_session.expired',
  'billing_document.finalized',
]);
export type ProviderEventType = z.infer<typeof ProviderEventTypeSchema>;

export const ProviderEventSchema = z
  .object({
    id: z.string().min(1),
    type: ProviderEventTypeSchema,
    resource: z.object({
      kind: EventResourceKindSchema,
      id: z.string().min(1),
    }),
    occurredAt: z.date(),
    payload: z.unknown().optional(),
    raw: z.unknown().optional(),
  })
  .openapi('ProviderEvent', {
    description:
      'Normalized event envelope. `payload` is the translated domain object when available; `raw` is the provider-native event for escape-hatch use.',
  });

export type ProviderEvent<TPayload = unknown> = Omit<
  z.infer<typeof ProviderEventSchema>,
  'payload'
> & { payload?: TPayload };
