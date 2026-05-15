import { z } from '../../zod.js';
import { ProviderDiscountSchema, type ProviderDiscount } from '../../models/discount.js';
import { pageOf, type Page } from '../../models/page.js';
import { PaginationInputSchema } from '../pagination.js';

export const DiscountsListInputSchema = PaginationInputSchema.extend({
  active: z.boolean().optional(),
})
  .optional()
  .openapi('DiscountsListInput');

export const DiscountsListOutputSchema = pageOf(ProviderDiscountSchema, 'DiscountsPage');

export type DiscountsListInput = z.infer<typeof DiscountsListInputSchema>;
export type DiscountsListOutput<TRaw = unknown> = Page<ProviderDiscount<TRaw>>;
