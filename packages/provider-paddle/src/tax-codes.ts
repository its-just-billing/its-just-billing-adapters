import type { TaxCategory } from '@its-just-billing/provider-sdk';
import type { TaxCategory as PaddleTaxCategory } from '@paddle/paddle-node-sdk';

/**
 * Normalized `TaxCategory` → Paddle tax category. The SDK enum is explicitly
 * "aligned with Paddle's native category set" (see `models/tax-category.ts`),
 * so this is a pure underscore→hyphen rename — every value maps 1:1 with no
 * loss. Kept as an explicit table (not a `.replace`) so a future divergence
 * in either enum is a compile error rather than a silent mismap.
 */
export const TAX_CATEGORY_TO_PADDLE: Record<TaxCategory, PaddleTaxCategory> = {
  digital_goods: 'digital-goods',
  ebooks: 'ebooks',
  implementation_services: 'implementation-services',
  professional_services: 'professional-services',
  saas: 'saas',
  software_programming_services: 'software-programming-services',
  standard: 'standard',
  training_services: 'training-services',
  website_hosting: 'website-hosting',
};

const PADDLE_TO_TAX_CATEGORY: Record<string, TaxCategory> = Object.fromEntries(
  Object.entries(TAX_CATEGORY_TO_PADDLE).map(([k, v]) => [v, k as TaxCategory]),
);

/**
 * Paddle tax category → normalized enum. Returns `'other'` for any Paddle
 * value the SDK enum doesn't cover (the raw code is preserved by the caller
 * in the reserved `__provider_tax_category_raw` metadata key). Paddle always
 * sets a tax category on a product, so unlike Stripe there is no `null` case.
 */
export function paddleToTaxCategory(code: string): TaxCategory | 'other' {
  return PADDLE_TO_TAX_CATEGORY[code] ?? 'other';
}
