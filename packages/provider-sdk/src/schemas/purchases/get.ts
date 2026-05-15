import { type ProviderPurchase, ProviderPurchaseSchema } from '../../models/purchase.js';
import { z } from '../../zod.js';

export const PurchasesGetInputSchema = z
  .object({ id: z.string().min(1) })
  .openapi('PurchasesGetInput');

export const PurchasesGetOutputSchema = ProviderPurchaseSchema.nullable();

export type PurchasesGetInput = z.infer<typeof PurchasesGetInputSchema>;
export type PurchasesGetOutput<TRaw = unknown> = ProviderPurchase<TRaw> | null;
