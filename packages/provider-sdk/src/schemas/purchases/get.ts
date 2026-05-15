import { z } from '../../zod.js';
import { ProviderPurchaseSchema, type ProviderPurchase } from '../../models/purchase.js';

export const PurchasesGetInputSchema = z
  .object({ id: z.string().min(1) })
  .openapi('PurchasesGetInput');

export const PurchasesGetOutputSchema = ProviderPurchaseSchema.nullable();

export type PurchasesGetInput = z.infer<typeof PurchasesGetInputSchema>;
export type PurchasesGetOutput<TRaw = unknown> = ProviderPurchase<TRaw> | null;
