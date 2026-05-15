import {
  CheckoutLineItemSchema,
  type ProviderCheckoutSession,
  ProviderCheckoutSessionSchema,
} from '../../models/checkout-session.js';
import { MetadataSchema } from '../../models/metadata.js';
import { TrialSpecSchema } from '../../models/trial.js';
import { z } from '../../zod.js';

const DiscountApplication = z
  .union([
    z.object({ kind: z.literal('discountId'), discountId: z.string().min(1) }).strict(),
    z.object({ kind: z.literal('code'), code: z.string().min(1) }).strict(),
    z.object({ kind: z.literal('allowPromotionCodes') }).strict(),
  ])
  .openapi('CheckoutDiscountApplication');

export const CheckoutCreateSessionInputSchema = z
  .object({
    customerId: z.string().min(1).optional(),
    lineItems: z.array(CheckoutLineItemSchema).min(1),
    successUrl: z.string().url(),
    cancelUrl: z.string().url().optional(),
    discount: DiscountApplication.optional(),
    // Trial offered on the resulting subscription, applied at checkout time.
    // Adapter rejects with ProviderNotSupportedError when the underlying
    // provider can't honor the requested unit (Stripe accepts day/week only).
    // Trials are only meaningful on sessions whose lineItems include at least
    // one recurring price; an adapter may reject a trial on an all-one-time
    // cart as ProviderValidationError.
    trial: TrialSpecSchema.optional(),
    metadata: MetadataSchema.optional(),
  })
  .openapi('CheckoutCreateSessionInput');

export const CheckoutCreateSessionOutputSchema = ProviderCheckoutSessionSchema;

export type CheckoutCreateSessionInput = z.infer<typeof CheckoutCreateSessionInputSchema>;
export type CheckoutCreateSessionOutput<
  TPresentation = unknown,
  TRaw = unknown,
> = ProviderCheckoutSession<TPresentation, TRaw>;
