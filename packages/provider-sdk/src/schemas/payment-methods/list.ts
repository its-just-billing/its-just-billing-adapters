import { z } from '../../zod.js';
import { ProviderPaymentMethodSchema } from '../../models/payment-method.js';
import { pageOf } from '../../models/page.js';

export const PaymentMethodsListInputSchema = z
  .object({ customerId: z.string().min(1) })
  .openapi('PaymentMethodsListInput');

export const PaymentMethodsListOutputSchema = pageOf(
  ProviderPaymentMethodSchema,
  'PaymentMethodsPage',
);

export type PaymentMethodsListInput = z.infer<typeof PaymentMethodsListInputSchema>;
export type PaymentMethodsListOutput = z.infer<typeof PaymentMethodsListOutputSchema>;
