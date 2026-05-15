import { z } from '../../zod.js';
import { ProviderProductSchema, type ProviderProduct } from '../../models/product.js';
import { MetadataSchema } from '../../models/metadata.js';

export const ProductsUpdateInputSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1).optional(),
    description: z.string().nullable().optional(),
    metadata: MetadataSchema.optional(),
  })
  .openapi('ProductsUpdateInput', {
    description:
      '`active` is intentionally excluded — use `deactivate` / `activate` for soft-delete state changes.',
  });

export const ProductsUpdateOutputSchema = ProviderProductSchema;

export type ProductsUpdateInput = z.infer<typeof ProductsUpdateInputSchema>;
export type ProductsUpdateOutput<TRaw = unknown> = ProviderProduct<TRaw>;
