import { z } from '../../zod.js';
import { ProviderDiscountSchema, type ProviderDiscount } from '../../models/discount.js';
import { MetadataSchema } from '../../models/metadata.js';

export const DiscountsUpdateInputSchema = z
  .object({
    id: z.string().min(1),
    expiresAt: z.date().nullable().optional(),
    metadata: MetadataSchema.optional(),
  })
  .openapi('DiscountsUpdateInput', {
    description:
      'Mutable fields only. Benefit, duration, code, and redemption limit are immutable post-create. `active` is excluded — use `deactivate` / `activate` for state changes.',
  });

export const DiscountsUpdateOutputSchema = ProviderDiscountSchema;

export type DiscountsUpdateInput = z.infer<typeof DiscountsUpdateInputSchema>;
export type DiscountsUpdateOutput<TRaw = unknown> = ProviderDiscount<TRaw>;
