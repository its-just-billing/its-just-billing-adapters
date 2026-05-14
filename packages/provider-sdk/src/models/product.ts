import { z } from '../zod.js';
import { MetadataSchema } from './metadata.js';
import { TaxCategoryOutputSchema } from './tax-category.js';

export const ProviderProductSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string().nullable(),
    active: z.boolean(),
    taxCategory: TaxCategoryOutputSchema,
    metadata: MetadataSchema,
    createdAt: z.date(),
    updatedAt: z.date(),
  })
  .openapi('ProviderProduct', {
    description:
      'Normalized product record. Prices are NOT embedded; query them through the `prices` domain. `taxCategory` is `TaxCategory` for SDK-managed products, `"other"` for dashboard-created products whose provider-native code does not map to the normalized enum, or `null` when no tax category is set.',
  });

export type ProviderProduct = z.infer<typeof ProviderProductSchema>;
