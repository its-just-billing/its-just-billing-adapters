import { z } from '../zod.js';
import { MoneySchema } from './money.js';
import { MetadataSchema } from './metadata.js';

export const PurchaseStatusSchema = z.enum([
  'pending',
  'succeeded',
  'failed',
  'refunded',
  'partially_refunded',
]);
export type PurchaseStatus = z.infer<typeof PurchaseStatusSchema>;

export const ProviderPurchaseSchema = z
  .object({
    id: z.string().min(1),
    customerId: z.string().nullable(),
    status: PurchaseStatusSchema,
    amount: MoneySchema,
    amountRefunded: MoneySchema.nullable(),
    priceId: z.string().nullable(),
    productId: z.string().nullable(),
    checkoutSessionId: z.string().nullable(),
    metadata: MetadataSchema,
    createdAt: z.date(),
    raw: z.unknown().optional(),
  })
  .openapi('ProviderPurchase', {
    description: 'A normalized one-time purchase / payment record.',
  });

export type ProviderPurchase<TRaw = unknown> = Omit<
  z.infer<typeof ProviderPurchaseSchema>,
  'raw'
> & { raw?: TRaw };
