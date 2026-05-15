import { z } from '../../zod.js';
import {
  ProviderPaymentMethodSchema,
  type ProviderPaymentMethod,
} from '../../models/payment-method.js';
import { pageOf, type Page } from '../../models/page.js';

export const PaymentMethodsListInputSchema = z
  .object({ customerId: z.string().min(1) })
  .openapi('PaymentMethodsListInput');

export const PaymentMethodsListOutputSchema = pageOf(
  ProviderPaymentMethodSchema,
  'PaymentMethodsPage',
);

export type PaymentMethodsListInput = z.infer<typeof PaymentMethodsListInputSchema>;
export type PaymentMethodsListOutput<TRaw = unknown> = Page<ProviderPaymentMethod<TRaw>>;
