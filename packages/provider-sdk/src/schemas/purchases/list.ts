import { z } from '../../zod.js';
import { ProviderPurchaseSchema, PurchaseStatusSchema } from '../../models/purchase.js';
import { pageOf } from '../../models/page.js';
import { PaginationInputSchema } from '../pagination.js';

export const PurchasesListInputSchema = PaginationInputSchema.extend({
  customerId: z.string().min(1).optional(),
  status: PurchaseStatusSchema.optional(),
})
  .optional()
  .openapi('PurchasesListInput');

export const PurchasesListOutputSchema = pageOf(ProviderPurchaseSchema, 'PurchasesPage');

export type PurchasesListInput = z.infer<typeof PurchasesListInputSchema>;
export type PurchasesListOutput = z.infer<typeof PurchasesListOutputSchema>;
