import { z } from '../../zod.js';
import { ProviderCustomerSchema, type ProviderCustomer } from '../../models/customer.js';
import { pageOf, type Page } from '../../models/page.js';
import { PaginationInputSchema } from '../pagination.js';

export const CustomersListInputSchema = PaginationInputSchema.extend({
  email: z.string().email().optional(),
})
  .optional()
  .openapi('CustomersListInput');

export const CustomersListOutputSchema = pageOf(ProviderCustomerSchema, 'CustomersPage');

export type CustomersListInput = z.infer<typeof CustomersListInputSchema>;
export type CustomersListOutput<TRaw = unknown> = Page<ProviderCustomer<TRaw>>;
