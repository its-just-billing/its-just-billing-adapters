import type { ProviderCapabilities, TaxCategory } from '@its-just-billing/provider-sdk';

const TAX_CATEGORIES: ReadonlySet<TaxCategory> = new Set<TaxCategory>([
  'digital_goods',
  'ebooks',
  'implementation_services',
  'professional_services',
  'saas',
  'software_programming_services',
  'standard',
  'training_services',
  'website_hosting',
]);

const CURRENCIES: ReadonlySet<string> = new Set<string>([
  'usd',
  'eur',
  'gbp',
  'jpy',
  'cad',
  'aud',
  'chf',
  'cny',
  'inr',
  'brl',
  'sek',
  'nok',
  'dkk',
  'sgd',
  'hkd',
  'nzd',
  'mxn',
  'zar',
  'krw',
  'twd',
  'thb',
  'pln',
  'czk',
  'huf',
  'ils',
  'aed',
  'sar',
  'ron',
  'try',
  'ars',
  'clp',
  'cop',
  'pen',
]);

export const MOCK_CAPABILITIES: ProviderCapabilities = {
  taxCategories: TAX_CATEGORIES,
  currencies: CURRENCIES,
};
