import { z } from '../zod.js';
import { MetadataSchema } from './metadata.js';

export const ProviderCustomerSchema = z
  .object({
    id: z.string().min(1).openapi({ description: 'Provider-native customer ID', example: 'cus_123' }),
    email: z.string().email().nullable(),
    name: z.string().nullable(),
    metadata: MetadataSchema,
    createdAt: z.date().openapi({ description: 'Creation time as a JS Date in UTC instant' }),
    raw: z
      .unknown()
      .optional()
      .openapi({
        description:
          'Provider-native customer object exposed as a typed escape hatch via the adapter`s TRaw generic. Typed `unknown` in adapter-agnostic code; adapters narrow it on their concrete provider type.',
      }),
  })
  .openapi('ProviderCustomer', { description: 'Normalized customer record' });

export type ProviderCustomer<TRaw = unknown> = Omit<
  z.infer<typeof ProviderCustomerSchema>,
  'raw'
> & { raw?: TRaw };
