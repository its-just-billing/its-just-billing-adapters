import { z } from '../zod.js';

/**
 * Build a Zod schema for a paginated page of `T`.
 *
 * Every list method on `BillingProvider` returns `Page<T>` so callers have an
 * opaque forward cursor to advance with. Cursors are SDK-opaque strings; the
 * adapter translates them to whatever the provider uses natively (Stripe
 * `starting_after`, Paddle `after`, etc).
 *
 * Pass `name` to register the resulting schema in the OpenAPI registry so
 * generated docs name the page type explicitly (e.g. `ProductsPage`).
 */
export function pageOf<T extends z.ZodTypeAny>(
  itemSchema: T,
  name?: string,
): z.ZodObject<{ data: z.ZodArray<T>; nextCursor: z.ZodNullable<z.ZodString> }> {
  const schema = z.object({
    data: z.array(itemSchema),
    nextCursor: z
      .string()
      .nullable()
      .openapi({
        description:
          'Opaque cursor to pass back as `cursor` on the next list call. `null` when there are no more results.',
      }),
  });
  return name ? schema.openapi(name) : schema;
}

export type Page<T> = { data: T[]; nextCursor: string | null };
