import { type Page, pageOf } from '../../models/page.js';
import {
  type ProviderWebhookEndpoint,
  ProviderWebhookEndpointSchema,
} from '../../models/webhook.js';
import { z } from '../../zod.js';

export const WebhooksListEndpointsInputSchema = z
  .object({})
  .optional()
  .openapi('WebhooksListEndpointsInput');

export const WebhooksListEndpointsOutputSchema = pageOf(
  ProviderWebhookEndpointSchema,
  'WebhookEndpointsPage',
);

export type WebhooksListEndpointsInput = z.infer<typeof WebhooksListEndpointsInputSchema>;
export type WebhooksListEndpointsOutput<TRaw = unknown> = Page<ProviderWebhookEndpoint<TRaw>>;
