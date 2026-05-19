import {
  type ProviderProduct,
  RESERVED_METADATA_KEYS,
  stripReservedKeys,
} from '@its-just-billing/provider-sdk';
import type { Product } from '@paddle/paddle-node-sdk';
import { paddleToTaxCategory } from '../tax-codes.js';

/**
 * Paddle product → normalized ProviderProduct.
 *
 * Paddle always sets a tax category on a product (it's a required field on
 * create), so — unlike Stripe — there is no `null` case; the value is either
 * a mapped `TaxCategory` or `'other'`. When it doesn't map cleanly we surface
 * the raw Paddle code through the reserved `__provider_tax_category_raw`
 * metadata key so callers dropping to `provider.raw` can recover it.
 *
 * Recurrence is intentionally omitted: Paddle's `capabilities.recurrenceModel`
 * is `'price'`, so the SDK contract leaves `ProviderProduct.recurrence`
 * unset and carries recurrence on `ProviderPrice` instead.
 *
 * `active` is derived from Paddle's two-state `status` (`active`/`archived`).
 */
export function normalizePaddleProduct(native: Product): ProviderProduct<Product> {
  const taxCategory = paddleToTaxCategory(native.taxCategory);
  // Paddle `customData` is the verbatim SDK metadata on write; coerce + strip
  // the reserved namespace on read, then re-introduce only the raw tax code
  // when the native category didn't map cleanly.
  const merged: Record<string, string> = {
    ...(native.customData
      ? Object.fromEntries(
          Object.entries(native.customData).map(([k, v]) => [
            k,
            typeof v === 'string' ? v : JSON.stringify(v),
          ]),
        )
      : {}),
  };
  if (taxCategory === 'other') {
    merged[RESERVED_METADATA_KEYS.TAX_CATEGORY_RAW] = native.taxCategory;
  }
  return {
    id: native.id,
    name: native.name,
    description: native.description,
    active: native.status === 'active',
    taxCategory,
    metadata: stripReservedKeys(merged),
    createdAt: new Date(native.createdAt),
    updatedAt: new Date(native.updatedAt),
    raw: native,
  };
}
