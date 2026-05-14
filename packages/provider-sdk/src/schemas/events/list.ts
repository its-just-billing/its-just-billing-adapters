import { z } from '../../zod.js';
import { ProviderEventSchema, ProviderEventTypeSchema } from '../../models/event.js';
import { pageOf } from '../../models/page.js';
import { PaginationInputSchema } from '../pagination.js';

export const EventsListInputSchema = PaginationInputSchema.extend({
  types: z.array(ProviderEventTypeSchema).optional(),
  since: z.date().optional(),
})
  .optional()
  .openapi('EventsListInput');

export const EventsListOutputSchema = pageOf(ProviderEventSchema, 'EventsPage');

export type EventsListInput = z.infer<typeof EventsListInputSchema>;
export type EventsListOutput = z.infer<typeof EventsListOutputSchema>;
