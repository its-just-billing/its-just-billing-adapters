import { z } from '../../zod.js';
import {
  ProviderWebhookEndpointSchema,
  type ProviderWebhookEndpoint,
} from '../../models/webhook.js';
import { pageOf, type Page } from '../../models/page.js';

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
