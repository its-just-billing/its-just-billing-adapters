import { z } from '../../zod.js';
import { ProviderEventTypeSchema } from '../../models/event.js';
import { ProviderWebhookEndpointSchema } from '../../models/webhook.js';

export const WebhooksCreateEndpointInputSchema = z
  .object({
    url: z.string().url(),
    eventTypes: z.array(ProviderEventTypeSchema).min(1),
  })
  .openapi('WebhooksCreateEndpointInput');

export const WebhooksCreateEndpointOutputSchema = ProviderWebhookEndpointSchema.extend({
  secret: z.string().min(1).nullable(),
}).openapi('WebhooksCreateEndpointOutput', {
  description:
    'Endpoint plus optional signing secret. Secrets are returned only at creation time if the provider supports readback.',
});

export type WebhooksCreateEndpointInput = z.infer<typeof WebhooksCreateEndpointInputSchema>;
export type WebhooksCreateEndpointOutput = z.infer<typeof WebhooksCreateEndpointOutputSchema>;
