import { z } from '../../zod.js';
import { ProviderPurchaseSchema } from '../../models/purchase.js';

export const PurchasesGetInputSchema = z
  .object({ id: z.string().min(1) })
  .openapi('PurchasesGetInput');

export const PurchasesGetOutputSchema = ProviderPurchaseSchema.nullable();

export type PurchasesGetInput = z.infer<typeof PurchasesGetInputSchema>;
export type PurchasesGetOutput = z.infer<typeof PurchasesGetOutputSchema>;
