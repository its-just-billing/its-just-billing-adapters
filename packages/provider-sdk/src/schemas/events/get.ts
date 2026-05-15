import { type ProviderEvent, ProviderEventSchema } from '../../models/event.js';
import { z } from '../../zod.js';

export const EventsGetInputSchema = z.object({ id: z.string().min(1) }).openapi('EventsGetInput');

export const EventsGetOutputSchema = ProviderEventSchema.nullable();

export type EventsGetInput = z.infer<typeof EventsGetInputSchema>;
export type EventsGetOutput<TPayload = unknown, TRaw = unknown> = ProviderEvent<
  TPayload,
  TRaw
> | null;
