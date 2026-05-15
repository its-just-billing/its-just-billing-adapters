import { z } from '../../zod.js';
import {
  DiscountBenefitSchema,
  DiscountDurationSchema,
  ProviderDiscountSchema,
  type ProviderDiscount,
} from '../../models/discount.js';
import { MetadataSchema } from '../../models/metadata.js';

export const DiscountsCreateInputSchema = z
  .object({
    code: z.string().min(1).nullable().optional(),
    benefit: DiscountBenefitSchema,
    duration: DiscountDurationSchema,
    expiresAt: z.date().nullable().optional(),
    redemptionLimit: z.number().int().positive().nullable().optional(),
    restrictedTo: z
      .object({
        productIds: z.array(z.string().min(1)).optional(),
        priceIds: z.array(z.string().min(1)).optional(),
      })
      .nullable()
      .optional(),
    metadata: MetadataSchema.optional(),
  })
  .openapi('DiscountsCreateInput');

export const DiscountsCreateOutputSchema = ProviderDiscountSchema;

export type DiscountsCreateInput = z.infer<typeof DiscountsCreateInputSchema>;
export type DiscountsCreateOutput<TRaw = unknown> = ProviderDiscount<TRaw>;
