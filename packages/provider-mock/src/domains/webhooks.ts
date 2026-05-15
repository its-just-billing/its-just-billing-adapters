import {
  type ProviderCapabilities,
  ProviderEventSchema,
  type ProviderEventType,
  ProviderNotFoundError,
  ProviderNotSupportedError,
  type ProviderWebhookEndpoint,
  Schemas,
  WebhookSignatureError,
  type Webhooks,
  validate,
} from '@its-just-billing/provider-sdk';
import { cloneDate } from '../clone-date.js';
import { nextId } from '../ids.js';
import { sortById } from '../pagination.js';
import type { InternalWebhookEndpoint, MockState } from '../state.js';
import { verifyMockWebhook } from '../webhook-signing.js';

function normalize(e: InternalWebhookEndpoint): ProviderWebhookEndpoint {
  return {
    id: e.id,
    url: e.url,
    eventTypes: e.eventTypes.slice(),
    active: e.active,
    createdAt: cloneDate(e.createdAt),
  };
}

function freshSecret(): string {
  return `whsec_mock_${Math.random().toString(36).slice(2, 18)}`;
}

/**
 * Reject `eventTypes` containing values outside the provider's webhook
 * capability set. The contract is "any subscribed event must be one this
 * provider can actually fire" — surfacing `ProviderNotSupportedError(422)`
 * before persisting the endpoint matches the pattern for currency / tax
 * category capabilities.
 */
function assertSupportedEventTypes(
  capabilities: ProviderCapabilities,
  eventTypes: readonly ProviderEventType[],
): void {
  for (const t of eventTypes) {
    if (!capabilities.webhookEventTypes.has(t)) {
      throw new ProviderNotSupportedError({
        feature: 'webhookEventType',
        value: t,
        message: `Provider does not emit ${t}; webhook endpoints cannot subscribe to it.`,
      });
    }
  }
}

export function createWebhooksDomain(
  state: MockState,
  capabilities: ProviderCapabilities,
): Webhooks {
  return {
    async listEndpoints(input) {
      validate(Schemas.Webhooks.WebhooksListEndpointsInputSchema, input, 'webhooks.listEndpoints');
      // `WebhooksListEndpointsInputSchema` has no cursor/limit fields, so
      // callers can't actually paginate. Return every endpoint in a single
      // page rather than silently truncating at the paginate() default cap.
      const rows = sortById(Array.from(state.webhookEndpoints.values()));
      return { data: rows.map(normalize), nextCursor: null };
    },

    async createEndpoint(input) {
      const parsed = validate(
        Schemas.Webhooks.WebhooksCreateEndpointInputSchema,
        input,
        'webhooks.createEndpoint',
      );
      assertSupportedEventTypes(capabilities, parsed.eventTypes);
      const record: InternalWebhookEndpoint = {
        id: nextId('wh'),
        url: parsed.url,
        eventTypes: parsed.eventTypes.slice(),
        active: true,
        createdAt: new Date(),
        secret: freshSecret(),
      };
      state.webhookEndpoints.set(record.id, record);
      return { ...normalize(record), secret: record.secret };
    },

    async updateEndpoint(input) {
      const parsed = validate(
        Schemas.Webhooks.WebhooksUpdateEndpointInputSchema,
        input,
        'webhooks.updateEndpoint',
      );
      if (parsed.eventTypes !== undefined) {
        assertSupportedEventTypes(capabilities, parsed.eventTypes);
      }
      const existing = state.webhookEndpoints.get(parsed.id);
      if (!existing) {
        throw new ProviderNotFoundError({ message: `Webhook endpoint ${parsed.id} not found` });
      }
      if (parsed.url !== undefined) existing.url = parsed.url;
      if (parsed.eventTypes !== undefined) existing.eventTypes = parsed.eventTypes.slice();
      if (parsed.active !== undefined) existing.active = parsed.active;
      return normalize(existing);
    },

    async activateEndpoint(input) {
      const parsed = validate(
        Schemas.Webhooks.WebhooksActivateEndpointInputSchema,
        input,
        'webhooks.activateEndpoint',
      );
      const existing = state.webhookEndpoints.get(parsed.id);
      if (!existing) return null;
      existing.active = true;
      return normalize(existing);
    },

    async deactivateEndpoint(input) {
      const parsed = validate(
        Schemas.Webhooks.WebhooksDeactivateEndpointInputSchema,
        input,
        'webhooks.deactivateEndpoint',
      );
      const existing = state.webhookEndpoints.get(parsed.id);
      if (!existing) return null;
      existing.active = false;
      return normalize(existing);
    },

    async deleteEndpoint(input) {
      const parsed = validate(
        Schemas.Webhooks.WebhooksDeleteEndpointInputSchema,
        input,
        'webhooks.deleteEndpoint',
      );
      const deleted = state.webhookEndpoints.delete(parsed.id);
      return { deleted };
    },

    async verify(input) {
      const parsed = validate(Schemas.Webhooks.WebhooksVerifyInputSchema, input, 'webhooks.verify');
      const result = verifyMockWebhook(parsed.payload, parsed.signature, parsed.secret);
      if (!result.ok) {
        throw new WebhookSignatureError({
          message: `webhook signature verification failed: ${result.reason ?? 'unknown'}`,
        });
      }
      const body =
        typeof parsed.payload === 'string'
          ? parsed.payload
          : new TextDecoder().decode(parsed.payload);
      let parsedBody: unknown;
      try {
        parsedBody = JSON.parse(body);
      } catch (err) {
        throw new WebhookSignatureError({
          message: 'webhook payload is not valid JSON',
          cause: err,
        });
      }
      const coerced = coerceOccurredAt(parsedBody);
      const eventResult = ProviderEventSchema.safeParse(coerced);
      if (!eventResult.success) {
        throw new WebhookSignatureError({
          message: `webhook payload does not match ProviderEvent shape: ${eventResult.error.message}`,
          cause: eventResult.error,
        });
      }
      return eventResult.data;
    },
  };
}

/**
 * JSON cannot encode Date instances, so the wire form of `occurredAt` is an
 * ISO-8601 string. Coerce it to a Date before handing the object to
 * `ProviderEventSchema.safeParse`, which expects a real Date. An unparseable
 * string becomes an Invalid Date, which `z.date()` rejects — so verify()
 * surfaces it as `WebhookSignatureError` rather than returning a malformed
 * event.
 */
function coerceOccurredAt(value: unknown): unknown {
  if (typeof value !== 'object' || value === null) return value;
  const v = value as Record<string, unknown>;
  if (typeof v.occurredAt === 'string') {
    return { ...v, occurredAt: new Date(v.occurredAt) };
  }
  return value;
}
