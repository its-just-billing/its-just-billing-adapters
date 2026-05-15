import type {
  EventsGetInput,
  EventsGetOutput,
  EventsListInput,
  EventsListOutput,
} from '../schemas/events/index.js';

export interface Events<TPayload = unknown, TRaw = unknown> {
  list(input?: EventsListInput): Promise<EventsListOutput<TPayload, TRaw>>;
  get(input: EventsGetInput): Promise<EventsGetOutput<TPayload, TRaw>>;
}
