import { z } from '../../zod.js';
import { ProviderProductSchema, type ProviderProduct } from '../../models/product.js';

export const ProductsActivateInputSchema = z
  .object({ id: z.string().min(1) })
  .openapi('ProductsActivateInput', {
    description:
      'Restore a soft-deleted product. Sets `active: true`. Returns the activated product, or null if no product with this id exists.',
  });

export const ProductsActivateOutputSchema = ProviderProductSchema.nullable();

export type ProductsActivateInput = z.infer<typeof ProductsActivateInputSchema>;
export type ProductsActivateOutput<TRaw = unknown> = ProviderProduct<TRaw> | null;
