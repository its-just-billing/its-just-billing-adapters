import { z } from '../zod.js';
import { MetadataSchema } from './metadata.js';

export const CheckoutSessionStatusSchema = z.enum(['open', 'complete', 'expired']);
export type CheckoutSessionStatus = z.infer<typeof CheckoutSessionStatusSchema>;

export const CheckoutLineItemSchema = z.object({
  priceId: z.string().min(1),
  quantity: z.number().int().positive(),
});
export type CheckoutLineItem = z.infer<typeof CheckoutLineItemSchema>;

/**
 * The Zod schema describes only the normalized portion of the session. The
 * `presentation` field is intentionally opaque at the SDK boundary — providers
 * differ on what callers need to actually render or redirect to checkout
 * (Stripe: hosted URL; Paddle: client token + items; embedded modes: a client
 * secret). Adapters are responsible for the runtime shape of `presentation`;
 * conformance only validates that it is present.
 */
export const ProviderCheckoutSessionSchema = z
  .object({
    id: z.string().min(1),
    status: CheckoutSessionStatusSchema,
    customerId: z.string().nullable(),
    lineItems: z.array(CheckoutLineItemSchema).min(1),
    successUrl: z.string().url(),
    cancelUrl: z.string().url().nullable(),
    metadata: MetadataSchema,
    expiresAt: z.date().nullable(),
    createdAt: z.date(),
    presentation: z.unknown().openapi({
      description:
        'Provider-specific bootstrap payload. Shape is declared by each adapter via its concrete TPresentation type. Examples: a hosted URL, an embedded client secret, or a frontend SDK token bundle.',
    }),
  })
  .openapi('ProviderCheckoutSession', {
    description:
      'Checkout session, partly normalized and partly provider-specific. The fields above the `presentation` field are normalized across all providers. `presentation` carries whatever the caller needs to render or redirect checkout for this specific provider.',
  });

/**
 * The TS type is generic on `TPresentation` so adapters can declare a concrete
 * presentation shape. The base `unknown` keeps adapter-agnostic call sites
 * (e.g. conformance, generic plumbing) honest.
 */
export type ProviderCheckoutSession<TPresentation = unknown> = Omit<
  z.infer<typeof ProviderCheckoutSessionSchema>,
  'presentation'
> & { presentation: TPresentation };
