import { z } from '../zod.js';
import { MetadataSchema } from './metadata.js';
import { MoneySchema } from './money.js';

// A zero-value `amountOff` would be a no-op discount; Stripe rejects it
// outright (`amount_off >= 1`), and there is no useful semantic for "discount
// of $0". The SDK contract mirrors that: amount discounts must be strictly
// positive. Percent discounts already required `> 0`.
const DiscountAmountBenefit = z.object({
  kind: z.literal('amount'),
  amountOff: MoneySchema.extend({
    amount: z
      .number()
      .int()
      .positive()
      .openapi({ description: 'Amount in minor units; must be at least 1', example: 1999 }),
  }),
});

export const DiscountBenefitSchema = z
  .discriminatedUnion('kind', [
    z.object({
      kind: z.literal('percent'),
      percentOff: z.number().positive().max(100),
    }),
    DiscountAmountBenefit,
  ])
  .openapi('DiscountBenefit');
export type DiscountBenefit = z.infer<typeof DiscountBenefitSchema>;

export const DiscountDurationSchema = z
  .discriminatedUnion('kind', [
    z.object({ kind: z.literal('once') }),
    z.object({ kind: z.literal('forever') }),
    z.object({ kind: z.literal('repeating'), months: z.number().int().positive() }),
  ])
  .openapi('DiscountDuration');
export type DiscountDuration = z.infer<typeof DiscountDurationSchema>;

export const ProviderDiscountSchema = z
  .object({
    id: z.string().min(1),
    code: z.string().nullable(),
    benefit: DiscountBenefitSchema,
    duration: DiscountDurationSchema,
    active: z.boolean(),
    expiresAt: z.date().nullable(),
    redemptionLimit: z.number().int().positive().nullable(),
    redemptionCount: z.number().int().nonnegative(),
    restrictedTo: z
      .object({
        productIds: z.array(z.string().min(1)).optional(),
        priceIds: z.array(z.string().min(1)).optional(),
      })
      .nullable(),
    metadata: MetadataSchema,
    createdAt: z.date(),
    raw: z.unknown().optional(),
  })
  .openapi('ProviderDiscount', {
    description: 'Normalized discount/coupon. May expose a public code or be discount-id only.',
  });

export type ProviderDiscount<TRaw = unknown> = Omit<
  z.infer<typeof ProviderDiscountSchema>,
  'raw'
> & { raw?: TRaw };
