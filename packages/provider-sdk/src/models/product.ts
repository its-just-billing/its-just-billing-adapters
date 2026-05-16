import { z } from '../zod.js';
import { MetadataSchema } from './metadata.js';
import { RecurringIntervalSchema } from './price.js';
import { TaxCategoryOutputSchema } from './tax-category.js';

/**
 * Billing recurrence expressed on the *product*. Only meaningful for
 * providers whose model attaches recurrence to the product rather than the
 * price (Polar). Providers with price-level recurrence
 * (`capabilities.features.priceLevelRecurrence`) leave this `null` and carry
 * recurrence on `ProviderPrice` instead. Shape mirrors the recurring price
 * kind so a consumer reads one concept regardless of provider.
 */
export const ProductRecurrenceSchema = z
  .object({
    interval: RecurringIntervalSchema,
    intervalCount: z.number().int().positive(),
  })
  .openapi('ProductRecurrence');

export type ProductRecurrence = z.infer<typeof ProductRecurrenceSchema>;

export const ProviderProductSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string().nullable(),
    active: z.boolean(),
    taxCategory: TaxCategoryOutputSchema,
    // Present (non-null) only for product-level-recurrence providers.
    // Optional so price-level adapters need not emit it — forward-compatible
    // for the future Polar adapter without revving existing ones.
    recurrence: ProductRecurrenceSchema.nullable().optional(),
    metadata: MetadataSchema,
    createdAt: z.date(),
    updatedAt: z.date(),
    raw: z.unknown().optional(),
  })
  .openapi('ProviderProduct', {
    description:
      'Normalized product record. Prices are NOT embedded; query them through the `prices` domain. `taxCategory` is `TaxCategory` for SDK-managed products, `"other"` for dashboard-created products whose provider-native code does not map to the normalized enum, or `null` when no tax category is set. `raw` is the provider-native product object exposed via the adapter`s TRaw generic.',
  });

export type ProviderProduct<TRaw = unknown> = Omit<z.infer<typeof ProviderProductSchema>, 'raw'> & {
  raw?: TRaw;
};
