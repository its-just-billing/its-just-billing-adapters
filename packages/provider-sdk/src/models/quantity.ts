import { z } from '../zod.js';

export const QuantitySchema = z
  .object({
    min: z.number().int().positive(),
    max: z.number().int().positive().optional(),
  })
  .refine((q) => q.max === undefined || q.max >= q.min, {
    message: 'quantity.max must be >= quantity.min',
    path: ['max'],
  })
  .openapi('Quantity', {
    description:
      'Normalized quantity constraint. `max` is the inclusive upper bound; omit `max` for an unbounded range.',
  });

export type Quantity = z.infer<typeof QuantitySchema>;

export type PriceKind = 'one_time' | 'recurring';

export function defaultQuantityFor(kind: PriceKind): Quantity {
  if (kind === 'recurring') return { min: 1, max: 1 };
  return { min: 1 };
}

export function isFixedSingleQuantity(q: Quantity): boolean {
  return q.min === 1 && q.max === 1;
}

export function isQuantityAdjustable(q: Quantity): boolean {
  return typeof q.max === 'number' && q.max > q.min;
}

export function isQuantityWithinConstraint(value: number, q: Quantity): boolean {
  if (!Number.isInteger(value) || value < 1) return false;
  if (value < q.min) return false;
  if (typeof q.max === 'number' && value > q.max) return false;
  return true;
}
