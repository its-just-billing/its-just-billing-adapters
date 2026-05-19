import type {
  EventResourceKind,
  ProviderEvent,
  ProviderEventType,
} from '@its-just-billing/provider-sdk';
import type { EventEntity } from '@paddle/paddle-node-sdk';

/**
 * Paddle event type → normalized ProviderEventType. Paddle types not mapped
 * here are silently dropped from the SDK's event surface; the contract only
 * exposes events whose type is in `ProviderEventType`.
 *
 * This map MUST stay in exact sync with `WEBHOOK_EVENT_TYPES` in
 * `../capabilities.ts`: every normalized type in that set needs at least one
 * Paddle source event here, and this map must not introduce a normalized type
 * the capability set doesn't advertise (otherwise `webhooks.createEndpoint`
 * would accept a subscription that can never fire, or reject one that can).
 * Same hand-maintained invariant Stripe documents on its `WEBHOOK_EVENT_TYPES`.
 *
 * Payment mapping (Paddle has no first-class "payment"; a payment is a
 * completed/paid transaction, and a refund is an adjustment):
 *   - `transaction.created`        → `payment.created`
 *   - `transaction.completed`      → `payment.succeeded` (terminal paid state)
 *   - `transaction.paid`           → `payment.succeeded` (paid, pre-fulfilment;
 *                                     same normalized signal — "money moved")
 *   - `transaction.payment_failed` → `payment.failed`
 *   - `adjustment.created`         → `payment.refunded` (refunds/credits are
 *                                     modeled as adjustments against a txn)
 *
 * Intentionally NOT mapped (kept consistent with the capability exclusions
 * documented in `../capabilities.ts`):
 *   - `customer.imported` / `discount.imported` / `*.imported` — import
 *     lifecycle, not a create/update the SDK models.
 *   - `subscription.activated|past_due|paused|resumed|trialing` — no SDK
 *     event; consumers diff `subscription.updated`.
 *   - `transaction.billed|ready|past_due|canceled|updated|revised` — not a
 *     money-movement signal the SDK's payment events represent.
 *   - `adjustment.updated` — the refund/credit is recorded on
 *     `adjustment.created`; an update adds no new payment signal.
 *   - `payout.*`, `address.*`, `business.*`, `api_key.*`, `report.*`,
 *     `client_token.*`, `discount_group.*`, `payment_method.*` — outside the
 *     normalized resource set.
 */
export const PADDLE_TO_NORMALIZED_EVENT: Record<string, ProviderEventType> = {
  'customer.created': 'customer.created',
  'customer.updated': 'customer.updated',
  'product.created': 'product.created',
  'product.updated': 'product.updated',
  'price.created': 'price.created',
  'price.updated': 'price.updated',
  'subscription.created': 'subscription.created',
  'subscription.updated': 'subscription.updated',
  'subscription.canceled': 'subscription.canceled',
  'transaction.created': 'payment.created',
  'transaction.completed': 'payment.succeeded',
  'transaction.paid': 'payment.succeeded',
  'transaction.payment_failed': 'payment.failed',
  'adjustment.created': 'payment.refunded',
  'discount.created': 'discount.created',
  'discount.updated': 'discount.updated',
};

/**
 * Inverse map (best-effort) used to translate the SDK-level `types` filter on
 * `events.list` and the `eventTypes` array on `webhooks.createEndpoint` into
 * the equivalent Paddle event names. Several normalized types map from more
 * than one Paddle type (e.g. `payment.succeeded` ← `transaction.completed` +
 * `transaction.paid`), so the value is an array.
 */
export const NORMALIZED_TO_PADDLE_EVENT: Record<ProviderEventType, string[]> = (() => {
  const out: Partial<Record<ProviderEventType, string[]>> = {};
  for (const [paddleType, normalized] of Object.entries(PADDLE_TO_NORMALIZED_EVENT)) {
    let arr = out[normalized];
    if (!arr) {
      arr = [];
      out[normalized] = arr;
    }
    arr.push(paddleType);
  }
  return out as Record<ProviderEventType, string[]>;
})();

const RESOURCE_KIND_FOR_EVENT: Record<ProviderEventType, EventResourceKind> = {
  'customer.created': 'customer',
  'customer.updated': 'customer',
  'customer.deleted': 'customer',
  'product.created': 'product',
  'product.updated': 'product',
  'price.created': 'price',
  'price.updated': 'price',
  'subscription.created': 'subscription',
  'subscription.updated': 'subscription',
  'subscription.canceled': 'subscription',
  'subscription.trial_will_end': 'subscription',
  'subscription.trial_ended': 'subscription',
  'payment.created': 'payment',
  'payment.succeeded': 'payment',
  'payment.failed': 'payment',
  'payment.refunded': 'payment',
  'discount.created': 'discount',
  'discount.updated': 'discount',
  'discount.archived': 'discount',
  'checkout_session.completed': 'checkout_session',
  'checkout_session.expired': 'checkout_session',
  'billing_document.finalized': 'billing_document',
};

/**
 * Map a Paddle event to the normalized event envelope. Returns `null` when
 * the Paddle type is not in {@link PADDLE_TO_NORMALIZED_EVENT}, signaling to
 * the caller to drop the event (same "filter to known types" rule the events
 * domain applies on list/get and the webhooks domain applies on verify).
 *
 * Paddle's `EventEntity` is a discriminated union whose `data` is the typed
 * notification resource (a `TransactionNotification`, `CustomerNotification`,
 * etc.); every such resource carries an `id`. The union is too wide to narrow
 * at compile time without an unsafe cast, so — like the Stripe normalizer —
 * we read `eventId`/`data.id` positionally.
 *
 * Exception: `adjustment.created` normalizes to `payment.refunded` with
 * `resource.kind: 'payment'`. The SDK contract is "refetch via
 * `payments.get({ id: resource.id })`", but a Paddle adjustment's `data.id`
 * is the adjustment id (`adj_...`), which is not a payment. The adjustment
 * carries the `transactionId` (`txn_...`) of the payment it adjusts, so the
 * refund event's `resource.id` must be that — otherwise consumers following
 * the contract refetch a non-existent payment. (`payload` still carries the
 * full adjustment.) If the transaction id is absent the event is dropped
 * rather than emitted with an unresolvable payment id.
 */
export function maybeNormalizePaddleEvent(
  native: EventEntity,
): ProviderEvent<unknown, EventEntity> | null {
  const eventType = (native as { eventType?: unknown }).eventType;
  if (typeof eventType !== 'string') return null;
  const normalizedType = PADDLE_TO_NORMALIZED_EVENT[eventType];
  if (!normalizedType) return null;
  const eventId = (native as { eventId?: unknown }).eventId;
  if (typeof eventId !== 'string' || eventId.length === 0) return null;
  const data = (native as { data?: { id?: unknown; transactionId?: unknown } }).data;
  // For refund/credit adjustments the refetchable payment id is the
  // adjustment's `transactionId`, not its own `id`.
  const resourceId =
    normalizedType === 'payment.refunded'
      ? data && typeof data.transactionId === 'string'
        ? data.transactionId
        : null
      : data && typeof data.id === 'string'
        ? data.id
        : null;
  if (!resourceId) return null;
  const occurredAtRaw = (native as { occurredAt?: unknown }).occurredAt;
  const occurredAt = typeof occurredAtRaw === 'string' ? new Date(occurredAtRaw) : new Date();
  return {
    id: eventId,
    type: normalizedType,
    resource: { kind: RESOURCE_KIND_FOR_EVENT[normalizedType], id: resourceId },
    occurredAt,
    payload: data,
    raw: native,
  };
}
