import { type ProviderPrice, ProviderPriceSchema } from '../../models/price.js';
import { z } from '../../zod.js';

export const PricesActivateInputSchema = z
  .object({ id: z.string().min(1) })
  .openapi('PricesActivateInput', {
    description:
      'Restore a soft-deleted price. Sets `active: true`. Returns the activated price, or null if no price with this id exists.',
  });

export const PricesActivateOutputSchema = ProviderPriceSchema.nullable();

export type PricesActivateInput = z.infer<typeof PricesActivateInputSchema>;
export type PricesActivateOutput<TRaw = unknown> = ProviderPrice<TRaw> | null;
