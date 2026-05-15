import { type Events, type ProviderEvent, Schemas, validate } from '@its-just-billing/provider-sdk';
import type Stripe from 'stripe';
import { isStripeNotFound, mapStripeError } from '../error-mapping.js';
import { NORMALIZED_TO_STRIPE_EVENT, maybeNormalizeStripeEvent } from '../normalize/event.js';

export function createEventsDomain(stripe: Stripe): Events<unknown, Stripe.Event> {
  return {
    async list(input) {
      const parsed =
        input !== undefined
          ? validate(Schemas.Events.EventsListInputSchema, input, 'events.list')
          : undefined;
      // Translate the SDK type filter into Stripe's native event names. When
      // the caller supplied a `types` filter but none of those normalized
      // types have a Stripe source (e.g. `purchase.created` — Stripe doesn't
      // fire a dedicated "purchase was created" event), the translated set is
      // empty. We must NOT then call Stripe without a `types` filter —
      // Stripe would interpret "no filter" as "all events" and silently widen
      // the caller's filter from "match these" to "match everything". Return
      // an empty page instead, preserving the semantics of the request.
      let stripeTypes: string[] | undefined;
      if (parsed?.types !== undefined) {
        stripeTypes = parsed.types.flatMap((t) => NORMALIZED_TO_STRIPE_EVENT[t] ?? []);
        if (stripeTypes.length === 0) {
          return { data: [], nextCursor: null };
        }
      }
      try {
        const native = await stripe.events.list({
          ...(parsed?.cursor !== undefined ? { starting_after: parsed.cursor } : {}),
          ...(parsed?.limit !== undefined ? { limit: parsed.limit } : {}),
          ...(stripeTypes !== undefined ? { types: stripeTypes } : {}),
          ...(parsed?.since !== undefined
            ? { created: { gte: Math.floor(parsed.since.getTime() / 1000) } }
            : {}),
        });
        const data = native.data
          .map(maybeNormalizeStripeEvent)
          .filter((e): e is ProviderEvent<unknown, Stripe.Event> => e !== null);
        const last = native.data[native.data.length - 1];
        const nextCursor = native.has_more && last ? last.id : null;
        return { data, nextCursor };
      } catch (err) {
        throw mapStripeError(err, 'events.list');
      }
    },

    async get(input) {
      const parsed = validate(Schemas.Events.EventsGetInputSchema, input, 'events.get');
      try {
        const native = await stripe.events.retrieve(parsed.id);
        const normalized = maybeNormalizeStripeEvent(native);
        // If the event type is outside the SDK's enum, surface it as "not
        // found" rather than returning a malformed event. Callers needing the
        // raw event must drop to provider.raw.
        return normalized;
      } catch (err) {
        if (isStripeNotFound(err)) return null;
        throw mapStripeError(err, 'events.get');
      }
    },
  };
}
