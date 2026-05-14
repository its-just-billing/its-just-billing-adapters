import { z } from '../zod.js';

/**
 * Normalized tax-category enum. Aligned with Paddle's native category set
 * (the smaller of the two) so every value maps cleanly on both Paddle and
 * Stripe. Stripe adapters translate to specific `txcd_*` codes internally.
 *
 * For provider-specific tax codes outside this enum, use `provider.raw`.
 */
export const TaxCategorySchema = z
  .enum([
    'digital_goods',
    'ebooks',
    'implementation_services',
    'professional_services',
    'saas',
    'software_programming_services',
    'standard',
    'training_services',
    'website_hosting',
  ])
  .openapi('TaxCategory', {
    description:
      'Normalized tax category. The exact provider tax-code translation is an adapter detail.',
  });

export type TaxCategory = z.infer<typeof TaxCategorySchema>;

/**
 * Read-side enum that allows the lossy-mapping fallback. On read, a product
 * created in the provider dashboard with a tax code the adapter cannot map
 * to the normalized enum surfaces as `'other'`; the raw provider code is
 * preserved in the reserved `__provider_tax_category_raw` metadata key
 * (visible only through `provider.raw`).
 *
 * `null` indicates the product has no tax category set at all.
 */
export const TaxCategoryOutputSchema = z
  .union([TaxCategorySchema, z.literal('other')])
  .nullable()
  .openapi('TaxCategoryOutput');

export type TaxCategoryOutput = z.infer<typeof TaxCategoryOutputSchema>;
