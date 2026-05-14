import { z } from '../../zod.js';
import {
  CheckoutLineItemSchema,
  ProviderCheckoutSessionSchema,
  type ProviderCheckoutSession,
} from '../../models/checkout-session.js';
import { MetadataSchema } from '../../models/metadata.js';

const DiscountApplication = z
  .union([
    z.object({ kind: z.literal('discountId'), discountId: z.string().min(1) }),
    z.object({ kind: z.literal('code'), code: z.string().min(1) }),
    z.object({ kind: z.literal('allowPromotionCodes') }),
  ])
  .openapi('CheckoutDiscountApplication');

export const CheckoutCreateSessionInputSchema = z
  .object({
    customerId: z.string().min(1).optional(),
    lineItems: z.array(CheckoutLineItemSchema).min(1),
    successUrl: z.string().url(),
    cancelUrl: z.string().url().optional(),
    discount: DiscountApplication.optional(),
    metadata: MetadataSchema.optional(),
  })
  .openapi('CheckoutCreateSessionInput');

export const CheckoutCreateSessionOutputSchema = ProviderCheckoutSessionSchema;

export type CheckoutCreateSessionInput = z.infer<typeof CheckoutCreateSessionInputSchema>;
export type CheckoutCreateSessionOutput<TPresentation = unknown> =
  ProviderCheckoutSession<TPresentation>;
