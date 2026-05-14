import { z } from '../zod.js';

export const CurrencySchema = z
  .string()
  .regex(/^[a-z]{3}$/, 'currency must be a lowercase 3-letter ISO code')
  .openapi({ description: 'Lowercase ISO 4217 currency code', example: 'usd' });

export const MoneySchema = z
  .object({
    amount: z
      .number()
      .int()
      .nonnegative()
      .openapi({ description: 'Amount in minor units (e.g. cents)', example: 1999 }),
    currency: CurrencySchema,
  })
  .openapi('Money', { description: 'A monetary amount in minor units plus ISO currency' });

export type Money = z.infer<typeof MoneySchema>;
export type Currency = z.infer<typeof CurrencySchema>;
