import { z } from '../../zod.js';
import { ProviderBillingDocumentSchema } from '../../models/billing-document.js';

export const BillingDocumentsGetInputSchema = z
  .object({ id: z.string().min(1) })
  .openapi('BillingDocumentsGetInput');

export const BillingDocumentsGetOutputSchema = ProviderBillingDocumentSchema.nullable();

export type BillingDocumentsGetInput = z.infer<typeof BillingDocumentsGetInputSchema>;
export type BillingDocumentsGetOutput = z.infer<typeof BillingDocumentsGetOutputSchema>;
