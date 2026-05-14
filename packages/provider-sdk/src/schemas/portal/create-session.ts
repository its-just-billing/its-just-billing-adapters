import { z } from '../../zod.js';
import { ProviderPortalSessionSchema } from '../../models/portal-session.js';

export const PortalCreateSessionInputSchema = z
  .object({
    customerId: z.string().min(1),
    returnUrl: z.string().url().optional(),
  })
  .openapi('PortalCreateSessionInput');

export const PortalCreateSessionOutputSchema = ProviderPortalSessionSchema;

export type PortalCreateSessionInput = z.infer<typeof PortalCreateSessionInputSchema>;
export type PortalCreateSessionOutput = z.infer<typeof PortalCreateSessionOutputSchema>;
