import { ProviderValidationError } from '../errors/validation.js';
import type { Money } from '../models/money.js';

/**
 * Throws ProviderValidationError if the two Money values are not in the same
 * currency. Use whenever an operation combines amounts (refunds, discounts).
 */
export function assertSameCurrency(a: Money, b: Money, methodLabel: string): void {
  if (a.currency !== b.currency) {
    throw new ProviderValidationError({
      message: `Currency mismatch in ${methodLabel}: ${a.currency} vs ${b.currency}`,
      issues: [
        {
          path: ['currency'],
          message: `expected ${a.currency}, got ${b.currency}`,
          code: 'currency_mismatch',
        },
      ],
    });
  }
}

export function normalizeCurrency(value: string): string {
  return value.trim().toLowerCase();
}
