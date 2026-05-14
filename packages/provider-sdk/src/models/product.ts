import { z } from '../zod.js';
import { MetadataSchema } from './metadata.js';

export const ProviderProductSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string().nullable(),
    active: z.boolean(),
    metadata: MetadataSchema,
    createdAt: z.date(),
    updatedAt: z.date(),
  })
  .openapi('ProviderProduct', {
    description:
      'Normalized product record. Prices are NOT embedded; query them through the `prices` domain.',
  });

export type ProviderProduct = z.infer<typeof ProviderProductSchema>;
