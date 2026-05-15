import {
  type ProviderCheckoutSession,
  ProviderCheckoutSessionSchema,
} from '../../models/checkout-session.js';
import { z } from '../../zod.js';

export const CheckoutGetSessionInputSchema = z
  .object({ id: z.string().min(1) })
  .openapi('CheckoutGetSessionInput');

export const CheckoutGetSessionOutputSchema = ProviderCheckoutSessionSchema.nullable();

export type CheckoutGetSessionInput = z.infer<typeof CheckoutGetSessionInputSchema>;
export type CheckoutGetSessionOutput<
  TPresentation = unknown,
  TRaw = unknown,
> = ProviderCheckoutSession<TPresentation, TRaw> | null;
