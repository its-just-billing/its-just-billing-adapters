import { z } from '../zod.js';
import { CurrencySchema } from './money.js';
import { MetadataSchema } from './metadata.js';
import { QuantitySchema } from './quantity.js';

export const RecurringIntervalSchema = z.enum(['day', 'week', 'month', 'year']);
export type RecurringInterval = z.infer<typeof RecurringIntervalSchema>;

const OneTimeKind = z.object({
  kind: z.literal('one_time'),
  unitAmount: z.number().int().nonnegative(),
});

const RecurringKind = z.object({
  kind: z.literal('recurring'),
  unitAmount: z.number().int().nonnegative(),
  interval: RecurringIntervalSchema,
  intervalCount: z.number().int().positive(),
});

export const ProviderPriceSchema = z
  .object({
    id: z.string().min(1),
    productId: z.string().min(1),
    active: z.boolean(),
    currency: CurrencySchema,
    quantity: QuantitySchema,
    metadata: MetadataSchema,
    createdAt: z.date(),
    updatedAt: z.date(),
    raw: z.unknown().optional(),
  })
  .and(z.discriminatedUnion('kind', [OneTimeKind, RecurringKind]))
  .openapi('ProviderPrice', {
    description: 'Normalized price record. Either one-time or recurring; quantity is first-class.',
  });

// `ProviderPriceSchema` is `base.and(discriminatedUnion('kind', ...))`, so its
// inferred type is `Base & (OneTime | Recurring)`. A plain `Omit<..., 'raw'>`
// collapses that union and erases per-kind fields (`interval`, `intervalCount`)
// after narrowing. Distributing Omit over the union preserves discrimination.
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

export type ProviderPrice<TRaw = unknown> = DistributiveOmit<
  z.infer<typeof ProviderPriceSchema>,
  'raw'
> & { raw?: TRaw };
