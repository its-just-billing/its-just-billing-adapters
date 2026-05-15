import { type ProviderPayment, ProviderPaymentSchema } from '../../models/payment.js';
import { z } from '../../zod.js';

export const PaymentsGetInputSchema = z
  .object({ id: z.string().min(1) })
  .openapi('PaymentsGetInput');

export const PaymentsGetOutputSchema = ProviderPaymentSchema.nullable();

export type PaymentsGetInput = z.infer<typeof PaymentsGetInputSchema>;
export type PaymentsGetOutput<TRaw = unknown> = ProviderPayment<TRaw> | null;
