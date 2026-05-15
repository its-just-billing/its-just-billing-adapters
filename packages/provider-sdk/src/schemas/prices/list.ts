import { type Page, pageOf } from '../../models/page.js';
import { type ProviderPrice, ProviderPriceSchema } from '../../models/price.js';
import { z } from '../../zod.js';
import { PaginationInputSchema } from '../pagination.js';

export const PricesListInputSchema = PaginationInputSchema.extend({
  productId: z.string().min(1).optional(),
  active: z.boolean().optional(),
})
  .optional()
  .openapi('PricesListInput');

export const PricesListOutputSchema = pageOf(ProviderPriceSchema, 'PricesPage');

export type PricesListInput = z.infer<typeof PricesListInputSchema>;
export type PricesListOutput<TRaw = unknown> = Page<ProviderPrice<TRaw>>;
