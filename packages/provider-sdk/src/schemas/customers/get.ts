import { z } from '../../zod.js';
import { ProviderCustomerSchema } from '../../models/customer.js';

export const CustomersGetInputSchema = z
  .object({
    id: z.string().min(1),
  })
  .openapi('CustomersGetInput');

export const CustomersGetOutputSchema = ProviderCustomerSchema.nullable();

export type CustomersGetInput = z.infer<typeof CustomersGetInputSchema>;
export type CustomersGetOutput = z.infer<typeof CustomersGetOutputSchema>;
