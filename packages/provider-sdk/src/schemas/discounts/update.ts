import { type ProviderDiscount, ProviderDiscountSchema } from '../../models/discount.js';
import { MetadataSchema } from '../../models/metadata.js';
import { z } from '../../zod.js';

export const DiscountsUpdateInputSchema = z
  .object({
    id: z.string().min(1),
    metadata: MetadataSchema.optional(),
  })
  .openapi('DiscountsUpdateInput', {
    description:
      'Mutable fields only. Benefit, duration, code, redemption limit, and expiration are immutable post-create — Stripe and Paddle both treat `expires_at` as create-only on the promotion code, and changing the discount value semantics after issue would surprise customers who hold redeemable codes. `active` is excluded — use `deactivate` / `activate` for state changes.',
  });

export const DiscountsUpdateOutputSchema = ProviderDiscountSchema;

export type DiscountsUpdateInput = z.infer<typeof DiscountsUpdateInputSchema>;
export type DiscountsUpdateOutput<TRaw = unknown> = ProviderDiscount<TRaw>;
