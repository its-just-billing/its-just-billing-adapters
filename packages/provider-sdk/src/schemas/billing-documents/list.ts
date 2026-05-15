import {
  BillingDocumentKindSchema,
  type ProviderBillingDocument,
  ProviderBillingDocumentSchema,
} from '../../models/billing-document.js';
import { type Page, pageOf } from '../../models/page.js';
import { z } from '../../zod.js';
import { PaginationInputSchema } from '../pagination.js';

export const BillingDocumentsListInputSchema = PaginationInputSchema.extend({
  customerId: z.string().min(1).optional(),
  kind: BillingDocumentKindSchema.optional(),
})
  .optional()
  .openapi('BillingDocumentsListInput');

export const BillingDocumentsListOutputSchema = pageOf(
  ProviderBillingDocumentSchema,
  'BillingDocumentsPage',
);

export type BillingDocumentsListInput = z.infer<typeof BillingDocumentsListInputSchema>;
export type BillingDocumentsListOutput<TRaw = unknown> = Page<ProviderBillingDocument<TRaw>>;
