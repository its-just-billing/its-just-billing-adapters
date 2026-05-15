import { z } from '../../zod.js';
import { ProviderCustomerSchema, type ProviderCustomer } from '../../models/customer.js';

export const CustomersArchiveInputSchema = z
  .object({
    id: z.string().min(1),
  })
  .openapi('CustomersArchiveInput');

export const CustomersArchiveOutputSchema = ProviderCustomerSchema.nullable();

export type CustomersArchiveInput = z.infer<typeof CustomersArchiveInputSchema>;
export type CustomersArchiveOutput<TRaw = unknown> = ProviderCustomer<TRaw> | null;
