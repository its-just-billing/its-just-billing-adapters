import { type ProviderPrice, ProviderPriceSchema } from '../../models/price.js';
import { z } from '../../zod.js';

export const PricesDeactivateInputSchema = z
  .object({ id: z.string().min(1) })
  .openapi('PricesDeactivateInput', {
    description:
      'Soft-delete a price. Sets `active: false`. Returns the deactivated price, or null if no price with this id exists.',
  });

export const PricesDeactivateOutputSchema = ProviderPriceSchema.nullable();

export type PricesDeactivateInput = z.infer<typeof PricesDeactivateInputSchema>;
export type PricesDeactivateOutput<TRaw = unknown> = ProviderPrice<TRaw> | null;
