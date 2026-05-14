import { z } from '../../zod.js';
import { ProviderWebhookEndpointSchema } from '../../models/webhook.js';
import { pageOf } from '../../models/page.js';

export const WebhooksListEndpointsInputSchema = z
  .object({})
  .optional()
  .openapi('WebhooksListEndpointsInput');

export const WebhooksListEndpointsOutputSchema = pageOf(
  ProviderWebhookEndpointSchema,
  'WebhookEndpointsPage',
);

export type WebhooksListEndpointsInput = z.infer<typeof WebhooksListEndpointsInputSchema>;
export type WebhooksListEndpointsOutput = z.infer<typeof WebhooksListEndpointsOutputSchema>;
