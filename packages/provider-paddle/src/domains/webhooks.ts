import {
  ProviderEventSchema,
  type ProviderEventType,
  ProviderNotFoundError,
  ProviderNotSupportedError,
  Schemas,
  WebhookSignatureError,
  type Webhooks,
  validate,
} from '@its-just-billing/provider-sdk';
import type {
  CreateNotificationSettingsRequestBody,
  EventEntity,
  IEventName,
  NotificationSettings,
  Paddle,
  UpdateNotificationSettingsRequestBody,
} from '@paddle/paddle-node-sdk';
import { PADDLE_CAPABILITIES } from '../capabilities.js';
import { isPaddleNotFound, mapPaddleError } from '../error-mapping.js';
import { maybeNormalizePaddleEvent } from '../normalize/event.js';
import {
  normalizePaddleNotificationSetting,
  normalizedEventsToPaddle,
} from '../normalize/webhook-endpoint.js';

/**
 * Reject `eventTypes` containing values Paddle doesn't emit. Paddle's own
 * `notificationSettings.create` would accept any string and silently never
 * fire, so we pre-flight against the normalized capability set and surface a
 * clean `ProviderNotSupportedError(422)` (mirrors the Stripe adapter).
 */
function assertSupportedEventTypes(eventTypes: readonly ProviderEventType[]): void {
  for (const t of eventTypes) {
    if (!PADDLE_CAPABILITIES.webhookEventTypes.has(t)) {
      throw new ProviderNotSupportedError({
        feature: 'webhookEventType',
        value: t,
        message: `Paddle does not emit ${t}; webhook endpoints cannot subscribe to it.`,
      });
    }
  }
}

export function createWebhooksDomain(paddle: Paddle): Webhooks<NotificationSettings, EventEntity> {
  return {
    async listEndpoints(input) {
      validate(Schemas.Webhooks.WebhooksListEndpointsInputSchema, input, 'webhooks.listEndpoints');
      // Paddle's notification-settings list returns the full set in one
      // Promise<NotificationSettings[]> (no cursor surface). Return it as a
      // single page with `nextCursor: null` — matches the mock's behavior.
      try {
        const native = await paddle.notificationSettings.list();
        return {
          data: native.map(normalizePaddleNotificationSetting),
          nextCursor: null,
        };
      } catch (err) {
        throw mapPaddleError(err, 'webhooks.listEndpoints');
      }
    },

    async createEndpoint(input) {
      const parsed = validate(
        Schemas.Webhooks.WebhooksCreateEndpointInputSchema,
        input,
        'webhooks.createEndpoint',
      );
      assertSupportedEventTypes(parsed.eventTypes);
      const subscribedEvents = normalizedEventsToPaddle(parsed.eventTypes) as IEventName[];
      const body: CreateNotificationSettingsRequestBody = {
        // Paddle requires a description; the SDK endpoint contract has no
        // such field, so derive a stable one from the destination URL.
        description: `Endpoint ${parsed.url}`,
        destination: parsed.url,
        subscribedEvents,
        type: 'url',
      };
      try {
        const native = await paddle.notificationSettings.create(body);
        return {
          ...normalizePaddleNotificationSetting(native),
          // Paddle returns the signing secret on the settings object; it is
          // readable on every read, but the SDK contract only surfaces it at
          // creation time.
          secret: native.endpointSecretKey || null,
        };
      } catch (err) {
        throw mapPaddleError(err, 'webhooks.createEndpoint');
      }
    },

    async updateEndpoint(input) {
      const parsed = validate(
        Schemas.Webhooks.WebhooksUpdateEndpointInputSchema,
        input,
        'webhooks.updateEndpoint',
      );
      if (parsed.eventTypes !== undefined) {
        assertSupportedEventTypes(parsed.eventTypes);
      }
      const body: UpdateNotificationSettingsRequestBody = {
        ...(parsed.url !== undefined ? { destination: parsed.url } : {}),
        ...(parsed.eventTypes !== undefined
          ? { subscribedEvents: normalizedEventsToPaddle(parsed.eventTypes) as IEventName[] }
          : {}),
        // Paddle's `active` is a real send/don't-send toggle (not a
        // soft-delete) — pass straight through.
        ...(parsed.active !== undefined ? { active: parsed.active } : {}),
      };
      try {
        const native = await paddle.notificationSettings.update(parsed.id, body);
        return normalizePaddleNotificationSetting(native);
      } catch (err) {
        if (isPaddleNotFound(err)) {
          throw new ProviderNotFoundError({
            message: `Webhook endpoint ${parsed.id} not found`,
          });
        }
        throw mapPaddleError(err, 'webhooks.updateEndpoint');
      }
    },

    async activateEndpoint(input) {
      const parsed = validate(
        Schemas.Webhooks.WebhooksActivateEndpointInputSchema,
        input,
        'webhooks.activateEndpoint',
      );
      try {
        const native = await paddle.notificationSettings.update(parsed.id, { active: true });
        return normalizePaddleNotificationSetting(native);
      } catch (err) {
        if (isPaddleNotFound(err)) return null;
        throw mapPaddleError(err, 'webhooks.activateEndpoint');
      }
    },

    async deactivateEndpoint(input) {
      const parsed = validate(
        Schemas.Webhooks.WebhooksDeactivateEndpointInputSchema,
        input,
        'webhooks.deactivateEndpoint',
      );
      try {
        const native = await paddle.notificationSettings.update(parsed.id, { active: false });
        return normalizePaddleNotificationSetting(native);
      } catch (err) {
        if (isPaddleNotFound(err)) return null;
        throw mapPaddleError(err, 'webhooks.deactivateEndpoint');
      }
    },

    async deleteEndpoint(input) {
      const parsed = validate(
        Schemas.Webhooks.WebhooksDeleteEndpointInputSchema,
        input,
        'webhooks.deleteEndpoint',
      );
      try {
        // Paddle's delete resolves `undefined` on success and throws on a
        // missing id; translate both into the `{ deleted }` contract.
        await paddle.notificationSettings.delete(parsed.id);
        return { deleted: true };
      } catch (err) {
        if (isPaddleNotFound(err)) return { deleted: false };
        throw mapPaddleError(err, 'webhooks.deleteEndpoint');
      }
    },

    async verify(input) {
      const parsed = validate(Schemas.Webhooks.WebhooksVerifyInputSchema, input, 'webhooks.verify');
      // Paddle's signature verifier takes the raw request body as a string.
      const body =
        typeof parsed.payload === 'string'
          ? parsed.payload
          : Buffer.from(parsed.payload).toString('utf8');
      let native: EventEntity;
      try {
        native = await paddle.webhooks.unmarshal(body, parsed.secret, parsed.signature);
      } catch (err) {
        throw new WebhookSignatureError({
          message: `webhook signature verification failed: ${
            err instanceof Error ? err.message : 'unknown'
          }`,
          cause: err,
        });
      }
      // `unmarshal` resolves a typed `EventEntity` on a valid signature (it
      // throws otherwise — handled above). Normalize; an event type outside
      // the SDK's enum yields null and is rejected as an unmappable payload.
      const normalized = maybeNormalizePaddleEvent(native);
      if (!normalized) {
        throw new WebhookSignatureError({
          message: `webhook payload type "${
            (native as { eventType?: unknown }).eventType ?? 'unknown'
          }" does not map to a normalized ProviderEvent`,
        });
      }
      // Final shape check: parse through ProviderEventSchema so any drift from
      // the normalizer (missing fields, malformed dates) surfaces as a
      // signature error rather than a silently broken event.
      const eventResult = ProviderEventSchema.safeParse(normalized);
      if (!eventResult.success) {
        throw new WebhookSignatureError({
          message: `webhook payload does not match ProviderEvent shape: ${eventResult.error.message}`,
          cause: eventResult.error,
        });
      }
      return normalized;
    },
  };
}
