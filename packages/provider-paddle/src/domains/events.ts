import { type Events, type ProviderEvent, Schemas, validate } from '@its-just-billing/provider-sdk';
import type { EventEntity, IEventName, Paddle } from '@paddle/paddle-node-sdk';
import { mapPaddleError } from '../error-mapping.js';
import { NORMALIZED_TO_PADDLE_EVENT, maybeNormalizePaddleEvent } from '../normalize/event.js';

// `events.get` is synthesized by scanning the event stream (Paddle has no
// get-by-event-id endpoint). Cap the scan so a missing id can't iterate the
// entire history — 20 pages at the default page size is a generous bound for
// "an event the caller just observed"; anything older resolves to null, the
// same shape an unknown id would produce.
const GET_MAX_PAGES = 20;

export function createEventsDomain(paddle: Paddle): Events<unknown, EventEntity> {
  return {
    async list(input) {
      const parsed =
        input !== undefined
          ? validate(Schemas.Events.EventsListInputSchema, input, 'events.list')
          : undefined;
      // Translate the SDK type filter into Paddle's native event names. When
      // the caller supplied a `types` filter but none of those normalized
      // types have a Paddle source, the translated set is empty. We must NOT
      // then call Paddle without an `eventType` filter — Paddle would treat
      // "no filter" as "all events" and silently widen the caller's filter
      // from "match these" to "match everything". Return an empty page
      // instead, preserving the request's semantics (mirrors Stripe).
      let eventTypes: IEventName[] | undefined;
      if (parsed?.types !== undefined) {
        eventTypes = parsed.types.flatMap(
          (t) => (NORMALIZED_TO_PADDLE_EVENT[t] ?? []) as IEventName[],
        );
        if (eventTypes.length === 0) {
          return { data: [], nextCursor: null };
        }
      }
      try {
        const collection = paddle.events.list({
          ...(parsed?.cursor !== undefined ? { after: parsed.cursor } : {}),
          ...(parsed?.limit !== undefined ? { perPage: parsed.limit } : {}),
          ...(eventTypes !== undefined ? { eventType: eventTypes } : {}),
        });
        const native = await collection.next();
        // Paddle's events list has no `since` filter; apply it client-side
        // when supplied (drop events that occurred before the cutoff).
        const sinceMs = parsed?.since !== undefined ? parsed.since.getTime() : null;
        const withinSince =
          sinceMs !== null
            ? native.filter((e) => new Date(e.occurredAt).getTime() >= sinceMs)
            : native;
        const data = withinSince
          .map(maybeNormalizePaddleEvent)
          .filter((e): e is ProviderEvent<unknown, EventEntity> => e !== null);
        const last = native[native.length - 1];
        const nextCursor = collection.hasMore && last ? last.eventId : null;
        return { data, nextCursor };
      } catch (err) {
        throw mapPaddleError(err, 'events.list');
      }
    },

    async get(input) {
      const parsed = validate(Schemas.Events.EventsGetInputSchema, input, 'events.get');
      // Paddle exposes no get-by-event-id; scan the (newest-first) event
      // stream for a matching `eventId`. An event whose type isn't in the
      // normalized map, or that's older than the scan bound, surfaces as
      // null — callers needing the raw event drop to provider.raw.
      try {
        const collection = paddle.events.list();
        for (let page = 0; page < GET_MAX_PAGES; page++) {
          const batch = await collection.next();
          if (batch.length === 0) break;
          const match = batch.find((e) => e.eventId === parsed.id);
          if (match) return maybeNormalizePaddleEvent(match);
          if (!collection.hasMore) break;
        }
        return null;
      } catch (err) {
        throw mapPaddleError(err, 'events.get');
      }
    },
  };
}
