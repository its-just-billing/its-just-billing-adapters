import { type Events, type ProviderEvent, Schemas, validate } from '@its-just-billing/provider-sdk';
import { cloneDate } from '../clone-date.js';
import { paginate } from '../pagination.js';
import type { MockState, StoredEvent } from '../state.js';

function normalize(e: StoredEvent): ProviderEvent {
  return {
    id: e.id,
    type: e.type,
    resource: { kind: e.resource.kind, id: e.resource.id },
    occurredAt: cloneDate(e.occurredAt),
    payload: e.payload,
  };
}

export function createEventsDomain(state: MockState): Events {
  return {
    async list(input) {
      const parsed = validate(Schemas.Events.EventsListInputSchema, input, 'events.list');
      let rows = state.events.slice();
      if (parsed?.types && parsed.types.length > 0) {
        const set = new Set(parsed.types);
        rows = rows.filter((e) => set.has(e.type));
      }
      if (parsed?.since) {
        const t = parsed.since.getTime();
        rows = rows.filter((e) => e.occurredAt.getTime() >= t);
      }
      rows.sort(
        (a, b) => a.occurredAt.getTime() - b.occurredAt.getTime() || a.id.localeCompare(b.id),
      );
      const page = paginate(rows, parsed?.cursor, parsed?.limit);
      return { data: page.data.map(normalize), nextCursor: page.nextCursor };
    },

    async get(input) {
      const parsed = validate(Schemas.Events.EventsGetInputSchema, input, 'events.get');
      const e = state.events.find((ev) => ev.id === parsed.id);
      return e ? normalize(e) : null;
    },
  };
}
