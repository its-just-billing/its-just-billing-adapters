import {
  type ProviderProduct,
  RESERVED_METADATA_KEYS,
  stripReservedKeys,
} from '@its-just-billing/provider-sdk';
import type Stripe from 'stripe';
import { fromUnixSeconds } from '../clone-date.js';
import { stripeToTaxCategory } from '../tax-codes.js';

function taxCodeOf(native: Stripe.Product): string | null {
  if (typeof native.tax_code === 'string') return native.tax_code;
  if (native.tax_code && typeof native.tax_code === 'object') return native.tax_code.id;
  return null;
}

export function normalizeStripeProduct(native: Stripe.Product): ProviderProduct<Stripe.Product> {
  const code = taxCodeOf(native);
  const taxCategory = stripeToTaxCategory(code);
  // When the native code didn't map cleanly, surface it through the reserved
  // metadata key so callers that drop to provider.raw can recover it.
  const merged: Stripe.Metadata = { ...(native.metadata ?? {}) };
  if (taxCategory === 'other' && code) {
    merged[RESERVED_METADATA_KEYS.TAX_CATEGORY_RAW] = code;
  }
  return {
    id: native.id,
    name: native.name,
    description: native.description,
    active: native.active,
    taxCategory,
    metadata: stripReservedKeys(merged),
    createdAt: fromUnixSeconds(native.created),
    updatedAt: fromUnixSeconds(native.updated),
    raw: native,
  };
}
