import { z } from '../../zod.js';
import { ProviderProductSchema } from '../../models/product.js';
import { pageOf } from '../../models/page.js';
import { PaginationInputSchema } from '../pagination.js';

export const ProductsListInputSchema = PaginationInputSchema.extend({
  active: z.boolean().optional(),
})
  .optional()
  .openapi('ProductsListInput');

export const ProductsListOutputSchema = pageOf(ProviderProductSchema, 'ProductsPage');

export type ProductsListInput = z.infer<typeof ProductsListInputSchema>;
export type ProductsListOutput = z.infer<typeof ProductsListOutputSchema>;
