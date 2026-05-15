import { MetadataSchema } from '../../models/metadata.js';
import { type ProviderProduct, ProviderProductSchema } from '../../models/product.js';
import { z } from '../../zod.js';

export const ProductsUpdateInputSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1).optional(),
    // `description` is omit-or-non-empty-string. Once a description is set
    // it cannot be unset — the SDK contract matches Stripe's constraint
    // ("description cannot be unset"). Pass a different non-empty string to
    // change it, or omit the field to leave it as-is. Empty string and null
    // are both rejected at validation.
    description: z.string().min(1).optional(),
    metadata: MetadataSchema.optional(),
  })
  .openapi('ProductsUpdateInput', {
    description:
      '`active` is intentionally excluded — use `deactivate` / `activate` for soft-delete state changes. `description`, once set, cannot be cleared (omit it to keep the existing value, or pass a new non-empty string to change it).',
  });

export const ProductsUpdateOutputSchema = ProviderProductSchema;

export type ProductsUpdateInput = z.infer<typeof ProductsUpdateInputSchema>;
export type ProductsUpdateOutput<TRaw = unknown> = ProviderProduct<TRaw>;
