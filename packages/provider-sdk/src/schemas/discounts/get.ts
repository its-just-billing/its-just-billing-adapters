import { z } from '../../zod.js';
import { ProviderDiscountSchema } from '../../models/discount.js';

export const DiscountsGetInputSchema = z
  .object({ id: z.string().min(1) })
  .openapi('DiscountsGetInput');

export const DiscountsGetOutputSchema = ProviderDiscountSchema.nullable();

export type DiscountsGetInput = z.infer<typeof DiscountsGetInputSchema>;
export type DiscountsGetOutput = z.infer<typeof DiscountsGetOutputSchema>;
