import { type ProviderCustomer, ProviderCustomerSchema } from '../../models/customer.js';
import { z } from '../../zod.js';

export const CustomersArchiveInputSchema = z
  .object({
    id: z.string().min(1),
  })
  .openapi('CustomersArchiveInput');

export const CustomersArchiveOutputSchema = ProviderCustomerSchema.nullable();

export type CustomersArchiveInput = z.infer<typeof CustomersArchiveInputSchema>;
export type CustomersArchiveOutput<TRaw = unknown> = ProviderCustomer<TRaw> | null;
