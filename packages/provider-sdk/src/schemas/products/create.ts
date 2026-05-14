import { z } from '../../zod.js';
import { ProviderProductSchema } from '../../models/product.js';
import { MetadataSchema } from '../../models/metadata.js';

export const ProductsCreateInputSchema = z
  .object({
    name: z.string().min(1),
    description: z.string().nullable().optional(),
    metadata: MetadataSchema.optional(),
  })
  .openapi('ProductsCreateInput', {
    description:
      'Newly created products are always active. To soft-delete, call `deactivate`; to restore, call `activate`.',
  });

export const ProductsCreateOutputSchema = ProviderProductSchema;

export type ProductsCreateInput = z.infer<typeof ProductsCreateInputSchema>;
export type ProductsCreateOutput = z.infer<typeof ProductsCreateOutputSchema>;
