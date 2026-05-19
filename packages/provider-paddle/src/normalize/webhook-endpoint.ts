import {
  type ProviderEventType,
  ProviderNormalizationError,
  type ProviderWebhookEndpoint,
} from '@its-just-billing/provider-sdk';
import type { NotificationSettings } from '@paddle/paddle-node-sdk';
import { NORMALIZED_TO_PADDLE_EVENT, PADDLE_TO_NORMALIZED_EVENT } from './event.js';

/**
 * Map Paddle's `subscribedEvents` (an array of `EventType`, each carrying a
 * `.name` like `transaction.completed`) into the normalized SDK event-type
 * enum. Paddle-only types are dropped silently — the round-trip is "best
 * effort" since not every Paddle event has an SDK equivalent (mirrors the
 * Stripe webhook-endpoint normalizer).
 */
function paddleEventsToNormalized(
  subscribed: NotificationSettings['subscribedEvents'],
): ProviderEventType[] {
  const set = new Set<ProviderEventType>();
  for (const e of subscribed) {
    const mapped = PADDLE_TO_NORMALIZED_EVENT[e.name];
    if (mapped) set.add(mapped);
  }
  return Array.from(set);
}

/**
 * Inverse — translate a normalized eventTypes array into the Paddle-native
 * event names needed for `subscribedEvents`. Each normalized type expands to
 * every Paddle alias that maps to it (e.g. `payment.succeeded` expands to
 * `transaction.completed` + `transaction.paid`). Throws when none of the
 * requested types have a Paddle equivalent — Paddle requires at least one
 * `subscribedEvents` entry, so an empty translation is a hard normalization
 * failure rather than a silently-empty subscription.
 */
export function normalizedEventsToPaddle(types: readonly ProviderEventType[]): string[] {
  const set = new Set<string>();
  for (const t of types) {
    const aliases = NORMALIZED_TO_PADDLE_EVENT[t];
    if (aliases) for (const a of aliases) set.add(a);
  }
  if (set.size === 0) {
    throw new ProviderNormalizationError({
      message:
        'None of the requested eventTypes have a Paddle equivalent. Paddle requires at least one subscribedEvents entry.',
    });
  }
  return Array.from(set);
}

/**
 * Paddle "notification setting" → normalized ProviderWebhookEndpoint.
 *
 * - `destination` is the delivery URL (Paddle's term for the endpoint target).
 * - `active` is Paddle's real send/don't-send toggle (not a soft-delete) —
 *   maps straight through to the SDK's `active`.
 * - Paddle does not expose a creation timestamp on a notification setting, so
 *   `createdAt` is surfaced as the Unix epoch. It satisfies the schema's
 *   `z.date()` and is stable across reads; callers needing the true creation
 *   time must reach for the provider dashboard (documented for live-sandbox
 *   verification — there is no field to source it from).
 */
export function normalizePaddleNotificationSetting(
  n: NotificationSettings,
): ProviderWebhookEndpoint<NotificationSettings> {
  return {
    id: n.id,
    url: n.destination,
    eventTypes: paddleEventsToNormalized(n.subscribedEvents),
    active: n.active,
    createdAt: new Date(0),
    raw: n,
  };
}
