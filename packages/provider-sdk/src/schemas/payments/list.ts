import { type Page, pageOf } from '../../models/page.js';
import {
  PaymentStatusSchema,
  type ProviderPayment,
  ProviderPaymentSchema,
} from '../../models/payment.js';
import { z } from '../../zod.js';
import { PaginationInputSchema } from '../pagination.js';

export const PaymentsListInputSchema = PaginationInputSchema.extend({
  customerId: z.string().min(1).optional(),
  status: PaymentStatusSchema.optional(),
})
  .optional()
  .openapi('PaymentsListInput');

export const PaymentsListOutputSchema = pageOf(ProviderPaymentSchema, 'PaymentsPage');

export type PaymentsListInput = z.infer<typeof PaymentsListInputSchema>;
export type PaymentsListOutput<TRaw = unknown> = Page<ProviderPayment<TRaw>>;
