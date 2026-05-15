import { type ProviderProduct, ProviderProductSchema } from '../../models/product.js';
import { z } from '../../zod.js';

export const ProductsGetInputSchema = z
  .object({ id: z.string().min(1) })
  .openapi('ProductsGetInput');

export const ProductsGetOutputSchema = ProviderProductSchema.nullable();

export type ProductsGetInput = z.infer<typeof ProductsGetInputSchema>;
export type ProductsGetOutput<TRaw = unknown> = ProviderProduct<TRaw> | null;
