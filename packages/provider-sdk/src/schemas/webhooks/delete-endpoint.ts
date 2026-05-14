import { z } from '../../zod.js';

export const WebhooksDeleteEndpointInputSchema = z
  .object({ id: z.string().min(1) })
  .openapi('WebhooksDeleteEndpointInput');

export const WebhooksDeleteEndpointOutputSchema = z.object({ deleted: z.boolean() });

export type WebhooksDeleteEndpointInput = z.infer<typeof WebhooksDeleteEndpointInputSchema>;
export type WebhooksDeleteEndpointOutput = z.infer<typeof WebhooksDeleteEndpointOutputSchema>;
