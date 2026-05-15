import { MetadataSchema } from '../../models/metadata.js';
import { type ProviderProduct, ProviderProductSchema } from '../../models/product.js';
import { TaxCategorySchema } from '../../models/tax-category.js';
import { z } from '../../zod.js';

export const ProductsCreateInputSchema = z
  .object({
    name: z.string().min(1),
    // `description` is either omitted (creates a product without a description)
    // or a non-empty string. Empty string is rejected — Stripe's product API
    // forbids it ("description cannot be unset") and the SDK contract mirrors
    // that constraint so behavior is consistent across providers.
    description: z.string().min(1).nullable().optional(),
    taxCategory: TaxCategorySchema,
    metadata: MetadataSchema.optional(),
  })
  .openapi('ProductsCreateInput', {
    description:
      'Newly created products are always active. `taxCategory` is required — both Stripe and Paddle benefit from an explicit tax category at create time. To soft-delete, call `deactivate`; to restore, call `activate`. `description` must be omitted or a non-empty string; empty string is rejected.',
  });

export const ProductsCreateOutputSchema = ProviderProductSchema;

export type ProductsCreateInput = z.infer<typeof ProductsCreateInputSchema>;
export type ProductsCreateOutput<TRaw = unknown> = ProviderProduct<TRaw>;
