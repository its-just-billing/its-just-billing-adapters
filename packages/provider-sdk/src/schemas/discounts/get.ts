import { z } from '../../zod.js';
import { ProviderDiscountSchema, type ProviderDiscount } from '../../models/discount.js';

export const DiscountsGetInputSchema = z
  .object({ id: z.string().min(1) })
  .openapi('DiscountsGetInput');

export const DiscountsGetOutputSchema = ProviderDiscountSchema.nullable();

export type DiscountsGetInput = z.infer<typeof DiscountsGetInputSchema>;
export type DiscountsGetOutput<TRaw = unknown> = ProviderDiscount<TRaw> | null;
