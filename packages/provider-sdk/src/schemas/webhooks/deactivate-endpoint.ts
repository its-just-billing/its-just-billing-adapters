import { z } from '../../zod.js';
import {
  ProviderWebhookEndpointSchema,
  type ProviderWebhookEndpoint,
} from '../../models/webhook.js';

export const WebhooksDeactivateEndpointInputSchema = z
  .object({ id: z.string().min(1) })
  .openapi('WebhooksDeactivateEndpointInput', {
    description:
      'Disable a webhook endpoint so the provider stops sending events to it (without deleting it). Equivalent to `updateEndpoint({ id, active: false })`. Returns null if no endpoint with this id exists.',
  });

export const WebhooksDeactivateEndpointOutputSchema = ProviderWebhookEndpointSchema.nullable();

export type WebhooksDeactivateEndpointInput = z.infer<
  typeof WebhooksDeactivateEndpointInputSchema
>;
export type WebhooksDeactivateEndpointOutput<TRaw = unknown> =
  ProviderWebhookEndpoint<TRaw> | null;
