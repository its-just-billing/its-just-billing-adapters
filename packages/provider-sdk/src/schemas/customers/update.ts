import { z } from '../../zod.js';
import { ProviderCustomerSchema } from '../../models/customer.js';
import { MetadataSchema } from '../../models/metadata.js';

export const CustomersUpdateInputSchema = z
  .object({
    id: z.string().min(1),
    email: z.string().email().nullable().optional(),
    name: z.string().min(1).nullable().optional(),
    metadata: MetadataSchema.optional(),
  })
  .openapi('CustomersUpdateInput');

export const CustomersUpdateOutputSchema = ProviderCustomerSchema;

export type CustomersUpdateInput = z.infer<typeof CustomersUpdateInputSchema>;
export type CustomersUpdateOutput = z.infer<typeof CustomersUpdateOutputSchema>;
