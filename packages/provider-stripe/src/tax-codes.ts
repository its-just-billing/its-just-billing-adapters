import type { TaxCategory } from '@its-just-billing/provider-sdk';

/**
 * Normalized TaxCategory → Stripe Tax Code. Codes come from Stripe's tax-code
 * catalog; they are stable identifiers but should be cross-checked against the
 * live Stripe Tax Codes API (`/v1/tax_codes`) when first wiring the adapter.
 */
export const TAX_CATEGORY_TO_STRIPE: Record<TaxCategory, string> = {
  digital_goods: 'txcd_10000000',
  ebooks: 'txcd_10302000',
  implementation_services: 'txcd_20060053',
  professional_services: 'txcd_20030000',
  saas: 'txcd_10103000',
  software_programming_services: 'txcd_20040051',
  standard: 'txcd_00000000',
  training_services: 'txcd_20060047',
  website_hosting: 'txcd_10101001',
};

const STRIPE_TO_TAX_CATEGORY: Record<string, TaxCategory> = Object.fromEntries(
  Object.entries(TAX_CATEGORY_TO_STRIPE).map(([k, v]) => [v, k as TaxCategory]),
);

/**
 * Stripe tax code → normalized enum. Returns `null` when no code is set,
 * `'other'` when the code is non-null but does not map to the SDK enum
 * (caller can still read the raw code via `__provider_tax_category_raw`).
 */
export function stripeToTaxCategory(code: string | null | undefined): TaxCategory | 'other' | null {
  if (code === null || code === undefined) return null;
  return STRIPE_TO_TAX_CATEGORY[code] ?? 'other';
}
