import { z } from '../../zod.js';
import { ProviderProductSchema } from '../../models/product.js';
import { MetadataSchema } from '../../models/metadata.js';
import { TaxCategorySchema } from '../../models/tax-category.js';

export const ProductsCreateInputSchema = z
  .object({
    name: z.string().min(1),
    description: z.string().nullable().optional(),
    taxCategory: TaxCategorySchema,
    metadata: MetadataSchema.optional(),
  })
  .openapi('ProductsCreateInput', {
    description:
      'Newly created products are always active. `taxCategory` is required — both Stripe and Paddle benefit from an explicit tax category at create time. To soft-delete, call `deactivate`; to restore, call `activate`.',
  });

export const ProductsCreateOutputSchema = ProviderProductSchema;

export type ProductsCreateInput = z.infer<typeof ProductsCreateInputSchema>;
export type ProductsCreateOutput = z.infer<typeof ProductsCreateOutputSchema>;
