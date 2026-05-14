import { z } from '../../zod.js';
import { ProviderEventTypeSchema } from '../../models/event.js';
import { ProviderWebhookEndpointSchema } from '../../models/webhook.js';

export const WebhooksUpdateEndpointInputSchema = z
  .object({
    id: z.string().min(1),
    url: z.string().url().optional(),
    eventTypes: z.array(ProviderEventTypeSchema).min(1).optional(),
    active: z.boolean().optional(),
  })
  .openapi('WebhooksUpdateEndpointInput', {
    description:
      'Update mutable fields on a webhook endpoint. Unlike products / prices / discounts, webhook `active` is a real send/don\'t-send toggle (not a soft-delete flag), so it is mutable here. `activate` / `deactivate` are also exposed as standalone methods for ergonomics.',
  });

export const WebhooksUpdateEndpointOutputSchema = ProviderWebhookEndpointSchema;

export type WebhooksUpdateEndpointInput = z.infer<typeof WebhooksUpdateEndpointInputSchema>;
export type WebhooksUpdateEndpointOutput = z.infer<typeof WebhooksUpdateEndpointOutputSchema>;
