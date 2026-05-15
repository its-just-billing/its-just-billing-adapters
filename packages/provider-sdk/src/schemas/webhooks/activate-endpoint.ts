import {
  type ProviderWebhookEndpoint,
  ProviderWebhookEndpointSchema,
} from '../../models/webhook.js';
import { z } from '../../zod.js';

export const WebhooksActivateEndpointInputSchema = z
  .object({ id: z.string().min(1) })
  .openapi('WebhooksActivateEndpointInput', {
    description:
      'Enable a webhook endpoint so the provider resumes sending events to it. Equivalent to `updateEndpoint({ id, active: true })`. Returns null if no endpoint with this id exists.',
  });

export const WebhooksActivateEndpointOutputSchema = ProviderWebhookEndpointSchema.nullable();

export type WebhooksActivateEndpointInput = z.infer<typeof WebhooksActivateEndpointInputSchema>;
export type WebhooksActivateEndpointOutput<TRaw = unknown> = ProviderWebhookEndpoint<TRaw> | null;
