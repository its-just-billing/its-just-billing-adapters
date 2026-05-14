import type {
  EventsGetInput,
  EventsGetOutput,
  EventsListInput,
  EventsListOutput,
} from '../schemas/events/index.js';

export interface Events {
  list(input?: EventsListInput): Promise<EventsListOutput>;
  get(input: EventsGetInput): Promise<EventsGetOutput>;
}
