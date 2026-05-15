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
import type Stripe from 'stripe';
import { STRIPE_CAPABILITIES } from '../capabilities.js';
import { isStripeNotFound, mapStripeError } from '../error-mapping.js';
import { maybeNormalizeStripeEvent } from '../normalize/event.js';
import {
  normalizeStripeWebhookEndpoint,
  normalizedEventsToStripe,
} from '../normalize/webhook-endpoint.js';

/**
 * Reject `eventTypes` containing values Stripe doesn't emit. Stripe's own
 * `webhookEndpoints.create` would accept any string and silently never fire,
 * so we pre-flight against the normalized capability set and surface a clean
 * `ProviderNotSupportedError(422)`.
 */
function assertSupportedEventTypes(eventTypes: readonly ProviderEventType[]): void {
  for (const t of eventTypes) {
    if (!STRIPE_CAPABILITIES.webhookEventTypes.has(t)) {
      throw new ProviderNotSupportedError({
        feature: 'webhookEventType',
        value: t,
        message: `Stripe does not emit ${t}; webhook endpoints cannot subscribe to it.`,
      });
    }
  }
}

export function createWebhooksDomain(
  stripe: Stripe,
): Webhooks<Stripe.WebhookEndpoint, Stripe.Event> {
  return {
    async listEndpoints(input) {
      validate(Schemas.Webhooks.WebhooksListEndpointsInputSchema, input, 'webhooks.listEndpoints');
      // The SDK list-endpoints schema has no cursor/limit fields. Iterate
      // Stripe's auto-pagination to surface every endpoint in a single page
      // and return `nextCursor: null` — matches the mock's behavior.
      const data: ReturnType<typeof normalizeStripeWebhookEndpoint>[] = [];
      try {
        for await (const ep of stripe.webhookEndpoints.list()) {
          data.push(normalizeStripeWebhookEndpoint(ep));
        }
      } catch (err) {
        throw mapStripeError(err, 'webhooks.listEndpoints');
      }
      return { data, nextCursor: null };
    },

    async createEndpoint(input) {
      const parsed = validate(
        Schemas.Webhooks.WebhooksCreateEndpointInputSchema,
        input,
        'webhooks.createEndpoint',
      );
      assertSupportedEventTypes(parsed.eventTypes);
      const enabledEvents = normalizedEventsToStripe(parsed.eventTypes);
      try {
        const native = await stripe.webhookEndpoints.create({
          url: parsed.url,
          // Stripe requires explicit event names here; we already validated
          // every requested SDK type maps to at least one Stripe alias.
          enabled_events: enabledEvents as Stripe.WebhookEndpointCreateParams.EnabledEvent[],
        });
        return {
          ...normalizeStripeWebhookEndpoint(native),
          secret: native.secret ?? null,
        };
      } catch (err) {
        throw mapStripeError(err, 'webhooks.createEndpoint');
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
      const params: Stripe.WebhookEndpointUpdateParams = {
        ...(parsed.url !== undefined ? { url: parsed.url } : {}),
        ...(parsed.eventTypes !== undefined
          ? {
              enabled_events: normalizedEventsToStripe(
                parsed.eventTypes,
              ) as Stripe.WebhookEndpointUpdateParams.EnabledEvent[],
            }
          : {}),
        ...(parsed.active !== undefined ? { disabled: !parsed.active } : {}),
      };
      try {
        const native = await stripe.webhookEndpoints.update(parsed.id, params);
        return normalizeStripeWebhookEndpoint(native);
      } catch (err) {
        if (isStripeNotFound(err)) {
          throw new ProviderNotFoundError({
            message: `Webhook endpoint ${parsed.id} not found`,
          });
        }
        throw mapStripeError(err, 'webhooks.updateEndpoint');
      }
    },

    async activateEndpoint(input) {
      const parsed = validate(
        Schemas.Webhooks.WebhooksActivateEndpointInputSchema,
        input,
        'webhooks.activateEndpoint',
      );
      try {
        const native = await stripe.webhookEndpoints.update(parsed.id, { disabled: false });
        return normalizeStripeWebhookEndpoint(native);
      } catch (err) {
        if (isStripeNotFound(err)) return null;
        throw mapStripeError(err, 'webhooks.activateEndpoint');
      }
    },

    async deactivateEndpoint(input) {
      const parsed = validate(
        Schemas.Webhooks.WebhooksDeactivateEndpointInputSchema,
        input,
        'webhooks.deactivateEndpoint',
      );
      try {
        const native = await stripe.webhookEndpoints.update(parsed.id, { disabled: true });
        return normalizeStripeWebhookEndpoint(native);
      } catch (err) {
        if (isStripeNotFound(err)) return null;
        throw mapStripeError(err, 'webhooks.deactivateEndpoint');
      }
    },

    async deleteEndpoint(input) {
      const parsed = validate(
        Schemas.Webhooks.WebhooksDeleteEndpointInputSchema,
        input,
        'webhooks.deleteEndpoint',
      );
      try {
        const result = await stripe.webhookEndpoints.del(parsed.id);
        return { deleted: result.deleted };
      } catch (err) {
        if (isStripeNotFound(err)) return { deleted: false };
        throw mapStripeError(err, 'webhooks.deleteEndpoint');
      }
    },

    async verify(input) {
      const parsed = validate(Schemas.Webhooks.WebhooksVerifyInputSchema, input, 'webhooks.verify');
      const body =
        typeof parsed.payload === 'string' ? parsed.payload : Buffer.from(parsed.payload);
      let native: Stripe.Event;
      try {
        native = stripe.webhooks.constructEvent(body, parsed.signature, parsed.secret);
      } catch (err) {
        throw new WebhookSignatureError({
          message: `webhook signature verification failed: ${
            err instanceof Error ? err.message : 'unknown'
          }`,
          cause: err,
        });
      }
      const normalized = maybeNormalizeStripeEvent(native);
      if (!normalized) {
        throw new WebhookSignatureError({
          message: `webhook payload type "${native.type}" does not map to a normalized ProviderEvent`,
        });
      }
      // Parse through ProviderEventSchema as a final shape check so any drift
      // from the normalizer (missing fields, malformed dates) surfaces as a
      // signature error rather than a silently broken event.
      const eventResult = ProviderEventSchema.safeParse(normalized);
      if (!eventResult.success) {
        throw new WebhookSignatureError({
          message: `webhook payload does not match ProviderEvent shape: ${eventResult.error.message}`,
          cause: eventResult.error,
        });
      }
      // safeParse strips unknown keys but preserves declared optionals
      // (`payload`, `raw`); the normalizer already populated those. Return
      // the parsed shape and let TS narrow it to the adapter's typed-raw
      // generic.
      return normalized;
    },
  };
}
