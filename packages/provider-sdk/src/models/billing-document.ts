import { z } from '../zod.js';
import { MoneySchema } from './money.js';
import { MetadataSchema } from './metadata.js';

export const BillingDocumentKindSchema = z.enum(['invoice', 'receipt', 'credit_note']);
export type BillingDocumentKind = z.infer<typeof BillingDocumentKindSchema>;

export const BillingDocumentStatusSchema = z.enum([
  'draft',
  'open',
  'paid',
  'void',
  'uncollectible',
]);
export type BillingDocumentStatus = z.infer<typeof BillingDocumentStatusSchema>;

export const ProviderBillingDocumentSchema = z
  .object({
    id: z.string().min(1),
    kind: BillingDocumentKindSchema,
    customerId: z.string().min(1),
    status: BillingDocumentStatusSchema,
    total: MoneySchema,
    subscriptionId: z.string().nullable(),
    hostedUrl: z.string().url().nullable(),
    pdfUrl: z.string().url().nullable(),
    metadata: MetadataSchema,
    createdAt: z.date(),
  })
  .openapi('ProviderBillingDocument');

export type ProviderBillingDocument = z.infer<typeof ProviderBillingDocumentSchema>;
