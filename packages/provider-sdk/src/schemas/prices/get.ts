import { z } from '../../zod.js';
import { ProviderPriceSchema, type ProviderPrice } from '../../models/price.js';

export const PricesGetInputSchema = z
  .object({ id: z.string().min(1) })
  .openapi('PricesGetInput');

export const PricesGetOutputSchema = ProviderPriceSchema.nullable();

export type PricesGetInput = z.infer<typeof PricesGetInputSchema>;
export type PricesGetOutput<TRaw = unknown> = ProviderPrice<TRaw> | null;
