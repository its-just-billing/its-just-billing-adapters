import { z } from '../zod.js';
import { ProviderEventTypeSchema } from './event.js';

export const ProviderWebhookEndpointSchema = z
  .object({
    id: z.string().min(1),
    url: z.string().url(),
    eventTypes: z.array(ProviderEventTypeSchema),
    active: z.boolean(),
    createdAt: z.date(),
    raw: z.unknown().optional(),
  })
  .openapi('ProviderWebhookEndpoint', {
    description:
      'Normalized webhook endpoint registration. The signing secret is returned only at creation time if the provider supports readback.',
  });

export type ProviderWebhookEndpoint<TRaw = unknown> = Omit<
  z.infer<typeof ProviderWebhookEndpointSchema>,
  'raw'
> & { raw?: TRaw };
