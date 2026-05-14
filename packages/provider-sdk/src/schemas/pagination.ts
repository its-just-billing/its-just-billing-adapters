import { z } from '../zod.js';

export const PaginationInputSchema = z
  .object({
    cursor: z.string().min(1).optional(),
    limit: z.number().int().positive().max(100).optional(),
  })
  .openapi('PaginationInput', {
    description:
      'Optional cursor-based pagination. List methods return a stable-sorted array; pagination cursors are opaque strings.',
  });

export type PaginationInput = z.infer<typeof PaginationInputSchema>;
