import { type Page, pageOf } from '../../models/page.js';
import {
  type ProviderPaymentMethod,
  ProviderPaymentMethodSchema,
} from '../../models/payment-method.js';
import { z } from '../../zod.js';

export const PaymentMethodsListInputSchema = z
  .object({ customerId: z.string().min(1) })
  .openapi('PaymentMethodsListInput');

export const PaymentMethodsListOutputSchema = pageOf(
  ProviderPaymentMethodSchema,
  'PaymentMethodsPage',
);

export type PaymentMethodsListInput = z.infer<typeof PaymentMethodsListInputSchema>;
export type PaymentMethodsListOutput<TRaw = unknown> = Page<ProviderPaymentMethod<TRaw>>;
