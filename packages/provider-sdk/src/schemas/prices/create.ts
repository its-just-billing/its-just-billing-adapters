import { z } from '../../zod.js';
import { ProviderPriceSchema, RecurringIntervalSchema } from '../../models/price.js';
import { CurrencySchema } from '../../models/money.js';
import { MetadataSchema } from '../../models/metadata.js';
import { QuantitySchema } from '../../models/quantity.js';

const OneTimeCreate = z.object({
  kind: z.literal('one_time'),
  unitAmount: z.number().int().nonnegative(),
});

const RecurringCreate = z.object({
  kind: z.literal('recurring'),
  unitAmount: z.number().int().nonnegative(),
  interval: RecurringIntervalSchema,
  intervalCount: z.number().int().positive().default(1),
});

export const PricesCreateInputSchema = z
  .object({
    productId: z.string().min(1),
    currency: CurrencySchema,
    quantity: QuantitySchema.optional(),
    metadata: MetadataSchema.optional(),
  })
  .and(z.discriminatedUnion('kind', [OneTimeCreate, RecurringCreate]))
  .openapi('PricesCreateInput', {
    description:
      'Create a one-time or recurring price. Newly created prices are always active; soft-delete via `deactivate`. Immutable fields (currency, kind, recurring shape) cannot be changed later — `update` only accepts metadata and quantity.',
  });

export const PricesCreateOutputSchema = ProviderPriceSchema;

export type PricesCreateInput = z.infer<typeof PricesCreateInputSchema>;
export type PricesCreateOutput = z.infer<typeof PricesCreateOutputSchema>;
