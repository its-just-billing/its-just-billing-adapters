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

// `product.archived` and `price.archived` were intentionally collapsed into
// the corresponding `*.updated` events: the recommended consumer pattern is
// to treat events as a re-sync signal (i.e. "refetch this resource") rather
// than as a payload to apply directly, so the active=true→false transition
// adds no information beyond "the resource changed; go look at it". Adapters
// emit `product.updated` / `price.updated` on deactivate.
export const ProviderEventTypeSchema = z.enum([
  'customer.created',
  'customer.updated',
  'customer.deleted',
  'product.created',
  'product.updated',
  'price.created',
  'price.updated',
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

export type ProviderEvent<TPayload = unknown, TRaw = unknown> = Omit<
  z.infer<typeof ProviderEventSchema>,
  'payload' | 'raw'
> & { payload?: TPayload; raw?: TRaw };
