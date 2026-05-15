import { type ProviderDiscount, ProviderDiscountSchema } from '../../models/discount.js';
import { z } from '../../zod.js';

export const DiscountsActivateInputSchema = z
  .object({ id: z.string().min(1) })
  .openapi('DiscountsActivateInput', {
    description:
      'Restore a soft-deleted discount. Sets `active: true`. Returns the activated discount, or null if no discount with this id exists.',
  });

export const DiscountsActivateOutputSchema = ProviderDiscountSchema.nullable();

export type DiscountsActivateInput = z.infer<typeof DiscountsActivateInputSchema>;
export type DiscountsActivateOutput<TRaw = unknown> = ProviderDiscount<TRaw> | null;
