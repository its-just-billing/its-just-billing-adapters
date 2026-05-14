import { z } from '../../zod.js';
import {
  ProviderCheckoutSessionSchema,
  type ProviderCheckoutSession,
} from '../../models/checkout-session.js';

export const CheckoutGetSessionInputSchema = z
  .object({ id: z.string().min(1) })
  .openapi('CheckoutGetSessionInput');

export const CheckoutGetSessionOutputSchema = ProviderCheckoutSessionSchema.nullable();

export type CheckoutGetSessionInput = z.infer<typeof CheckoutGetSessionInputSchema>;
export type CheckoutGetSessionOutput<TPresentation = unknown> =
  ProviderCheckoutSession<TPresentation> | null;
