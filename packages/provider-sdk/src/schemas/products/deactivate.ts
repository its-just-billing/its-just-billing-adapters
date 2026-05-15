import { z } from '../../zod.js';
import { ProviderProductSchema, type ProviderProduct } from '../../models/product.js';

export const ProductsDeactivateInputSchema = z
  .object({ id: z.string().min(1) })
  .openapi('ProductsDeactivateInput', {
    description:
      'Soft-delete a product. Sets `active: false`. Returns the deactivated product, or null if no product with this id exists.',
  });

export const ProductsDeactivateOutputSchema = ProviderProductSchema.nullable();

export type ProductsDeactivateInput = z.infer<typeof ProductsDeactivateInputSchema>;
export type ProductsDeactivateOutput<TRaw = unknown> = ProviderProduct<TRaw> | null;
