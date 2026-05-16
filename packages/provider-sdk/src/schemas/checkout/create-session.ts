import {
  CheckoutLineItemSchema,
  type ProviderCheckoutSession,
  ProviderCheckoutSessionSchema,
} from '../../models/checkout-session.js';
import { MetadataSchema } from '../../models/metadata.js';
import { TrialSpecSchema } from '../../models/trial.js';
import { z } from '../../zod.js';

// `checkout.createSession` is a pure pass-through: the adapter maps these
// fields straight onto the provider's session create call and lets the
// provider accept/reject. There is no `code` kind — resolving a human code to
// its discount id is a round trip the consumer (which persists its own
// discounts) must do; pass the resolved `discountId` instead.
const DiscountApplication = z
  .union([
    z.object({ kind: z.literal('discountId'), discountId: z.string().min(1) }).strict(),
    z.object({ kind: z.literal('allowPromotionCodes') }).strict(),
  ])
  .openapi('CheckoutDiscountApplication');

export const CheckoutCreateSessionInputSchema = z
  .object({
    customerId: z.string().min(1).optional(),
    lineItems: z.array(CheckoutLineItemSchema).min(1),
    // Required: the session billing mode. Providers like Stripe require this
    // up front and do NOT infer it from the prices. The consumer holds price
    // recurrence in its own persistence and computes this without a round
    // trip — the adapter never fetches prices to discover it.
    mode: z.enum(['payment', 'subscription']),
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
