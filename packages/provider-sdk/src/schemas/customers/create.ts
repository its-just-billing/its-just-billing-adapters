import { type ProviderCustomer, ProviderCustomerSchema } from '../../models/customer.js';
import { MetadataSchema } from '../../models/metadata.js';
import { z } from '../../zod.js';

export const CustomersCreateInputSchema = z
  .object({
    email: z.string().email().nullable().optional(),
    name: z.string().min(1).nullable().optional(),
    metadata: MetadataSchema.optional(),
  })
  .openapi('CustomersCreateInput');

export const CustomersCreateOutputSchema = ProviderCustomerSchema;

export type CustomersCreateInput = z.infer<typeof CustomersCreateInputSchema>;
export type CustomersCreateOutput<TRaw = unknown> = ProviderCustomer<TRaw>;
