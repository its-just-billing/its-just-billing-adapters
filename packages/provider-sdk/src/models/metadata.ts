import { z } from '../zod.js';

export const RESERVED_METADATA_PREFIX = '__provider_';

export const RESERVED_METADATA_KEYS = {
  QUANTITY_MIN: '__provider_quantity_min',
  QUANTITY_MAX: '__provider_quantity_max',
  /**
   * Holds the provider-native tax code (e.g. Stripe's `txcd_*`) when a
   * product's tax category is read but does not map to the normalized
   * TaxCategory enum. Allows round-trip via provider.raw.
   */
  TAX_CATEGORY_RAW: '__provider_tax_category_raw',
} as const;

export const MetadataSchema = z.record(z.string(), z.string()).openapi('Metadata', {
  description:
    'Flat string-to-string record. Keys starting with `__provider_` are reserved for adapter-managed use and must not be supplied by callers.',
});

export type Metadata = z.infer<typeof MetadataSchema>;

export function isReservedMetadataKey(key: string): boolean {
  return key.startsWith(RESERVED_METADATA_PREFIX);
}

export function findReservedKeys(metadata: Metadata | undefined): string[] {
  if (!metadata) return [];
  return Object.keys(metadata).filter(isReservedMetadataKey);
}
