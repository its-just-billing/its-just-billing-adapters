import { type ProviderEvent, ProviderEventSchema } from '../../models/event.js';
import { z } from '../../zod.js';

export const WebhooksVerifyInputSchema = z
  .object({
    payload: z.union([z.string(), z.instanceof(Uint8Array)]),
    signature: z.string().min(1),
    secret: z.string().min(1),
  })
  .openapi('WebhooksVerifyInput', {
    description:
      'Verify a signed webhook payload and extract the normalized event. Throws WebhookSignatureError on failure.',
  });

export const WebhooksVerifyOutputSchema = ProviderEventSchema;

export type WebhooksVerifyInput = z.infer<typeof WebhooksVerifyInputSchema>;
export type WebhooksVerifyOutput<TPayload = unknown, TRaw = unknown> = ProviderEvent<
  TPayload,
  TRaw
>;
