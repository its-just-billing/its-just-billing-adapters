import { z } from '../../zod.js';
import { ProviderDiscountSchema, type ProviderDiscount } from '../../models/discount.js';

export const DiscountsDeactivateInputSchema = z
  .object({ id: z.string().min(1) })
  .openapi('DiscountsDeactivateInput', {
    description:
      'Soft-delete a discount. Sets `active: false`. Returns the deactivated discount, or null if no discount with this id exists.',
  });

export const DiscountsDeactivateOutputSchema = ProviderDiscountSchema.nullable();

export type DiscountsDeactivateInput = z.infer<typeof DiscountsDeactivateInputSchema>;
export type DiscountsDeactivateOutput<TRaw = unknown> = ProviderDiscount<TRaw> | null;
