import { z } from '../../zod.js';
import { ProviderEventSchema } from '../../models/event.js';

export const EventsGetInputSchema = z
  .object({ id: z.string().min(1) })
  .openapi('EventsGetInput');

export const EventsGetOutputSchema = ProviderEventSchema.nullable();

export type EventsGetInput = z.infer<typeof EventsGetInputSchema>;
export type EventsGetOutput = z.infer<typeof EventsGetOutputSchema>;
