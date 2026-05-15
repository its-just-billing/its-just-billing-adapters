import { z } from '../zod.js';

export const ProviderPortalSessionSchema = z
  .object({
    id: z.string().min(1),
    url: z.string().url(),
    customerId: z.string().min(1),
    returnUrl: z.string().url().nullable(),
    expiresAt: z.date().nullable(),
    createdAt: z.date(),
    raw: z.unknown().optional(),
  })
  .openapi('ProviderPortalSession');

export type ProviderPortalSession<TRaw = unknown> = Omit<
  z.infer<typeof ProviderPortalSessionSchema>,
  'raw'
> & { raw?: TRaw };
