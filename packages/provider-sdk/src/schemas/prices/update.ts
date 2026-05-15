import { z } from '../../zod.js';
import { ProviderPriceSchema, type ProviderPrice } from '../../models/price.js';
import { MetadataSchema } from '../../models/metadata.js';
import { QuantitySchema } from '../../models/quantity.js';

export const PricesUpdateInputSchema = z
  .object({
    id: z.string().min(1),
    metadata: MetadataSchema.optional(),
    quantity: QuantitySchema.optional(),
  })
  .openapi('PricesUpdateInput', {
    description:
      'Update mutable fields only. Adapters must reject attempts to change currency, kind, or recurring shape with a ProviderConstraintError (422). `active` is excluded — use `deactivate` / `activate` for state changes.',
  });

export const PricesUpdateOutputSchema = ProviderPriceSchema;

export type PricesUpdateInput = z.infer<typeof PricesUpdateInputSchema>;
export type PricesUpdateOutput<TRaw = unknown> = ProviderPrice<TRaw>;
