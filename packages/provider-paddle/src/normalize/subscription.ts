import {
  type PendingSubscriptionChange,
  type ProviderSubscription,
  ProviderUnmanagedStateError,
  type SubscriptionItem,
  type SubscriptionStatus,
} from '@its-just-billing/provider-sdk';
import type {
  SubscriptionItem as PaddleSubscriptionItem,
  Subscription,
} from '@paddle/paddle-node-sdk';
import { paddleCustomDataToMetadata } from '../metadata.js';

/**
 * Map Paddle's subscription status onto the SDK's. Paddle's set is
 * `active|canceled|past_due|paused|trialing`. `paused` is not modeled by the
 * SDK (pause/resume are intentionally out of scope) — surface it as an
 * unmanaged-state boundary rather than collapsing it into `active` (which
 * would mis-report billing state), mirroring how the Stripe normalizer
 * handles Stripe's own `paused`.
 */
function statusOf(s: Subscription): SubscriptionStatus {
  switch (s.status) {
    case 'active':
      return 'active';
    case 'trialing':
      return 'trialing';
    case 'past_due':
      return 'past_due';
    case 'canceled':
      return 'canceled';
    case 'paused':
      throw new ProviderUnmanagedStateError({
        field: 'subscription.status',
        expected: 'active|trialing|past_due|canceled',
        found: s.status,
        message: `Subscription ${s.id} is in Paddle's 'paused' state, which the SDK does not model. Use provider.raw to handle it.`,
      });
    default:
      throw new ProviderUnmanagedStateError({
        field: 'subscription.status',
        expected: 'active|trialing|past_due|canceled',
        found: s.status,
        message: `Subscription ${s.id} has an unrecognized Paddle status '${String(s.status)}'.`,
      });
  }
}

function priceIdOf(item: PaddleSubscriptionItem): string {
  const id = item.price?.id;
  if (typeof id === 'string' && id.length > 0) return id;
  throw new ProviderUnmanagedStateError({
    field: 'subscription.items[].price',
    expected: 'a price reference',
    found: item.price,
    message: 'Subscription item has no price reference',
  });
}

function itemsOf(s: Subscription): SubscriptionItem[] {
  // Paddle subscription items have no stable per-line id (the line is keyed
  // by its price); synthesize a deterministic id from the price so the
  // normalized shape always has a non-empty `id`, mirroring how the Stripe
  // normalizer treats scheduled-phase items.
  return s.items.map((it) => {
    const priceId = priceIdOf(it);
    return { id: `item_${priceId}`, priceId, quantity: it.quantity };
  });
}

export function normalizePaddleSubscription(
  native: Subscription,
): ProviderSubscription<Subscription> {
  const status = statusOf(native);
  const items = itemsOf(native);

  // Paddle's `currentBillingPeriod` is null for a not-yet-started / canceled
  // subscription. The SDK contract requires both period bounds; fall back to
  // `createdAt` for the start and `nextBilledAt` (or `createdAt`) for the end
  // so the normalized shape always satisfies the schema without inventing a
  // window the consumer would treat as authoritative billing state.
  const period = native.currentBillingPeriod;
  const currentPeriodStart = period ? new Date(period.startsAt) : new Date(native.createdAt);
  const currentPeriodEnd = period
    ? new Date(period.endsAt)
    : native.nextBilledAt
      ? new Date(native.nextBilledAt)
      : new Date(native.createdAt);

  // Paddle expresses every pending mutation through a single
  // `scheduledChange` object (`action: cancel|pause|resume`, `effectiveAt`).
  //   - `cancel`  → SDK `pendingChange.kind = 'cancel'` + `cancelAtPeriodEnd`.
  //   - `pause`/`resume` → not modeled by the SDK (pause/resume are out of
  //     scope); refuse at the unmanaged-state boundary so it can't be silently
  //     dropped, consistent with the `paused` status handling above.
  // A scheduled *price/quantity change* in Paddle is applied immediately or
  // at the next billing period via `subscriptions.update` (it does not surface
  // as a `scheduledChange`), so there is no `price_change` pending shape to
  // reconstruct on read.
  const sc = native.scheduledChange;
  let pendingChange: PendingSubscriptionChange | null = null;
  let cancelAtPeriodEnd = false;
  if (sc) {
    if (sc.action === 'cancel') {
      cancelAtPeriodEnd = true;
      pendingChange = { kind: 'cancel', effectiveAt: new Date(sc.effectiveAt) };
    } else {
      throw new ProviderUnmanagedStateError({
        field: 'subscription.scheduledChange.action',
        expected: 'cancel (pause/resume are not modeled)',
        found: sc.action,
        message: `Subscription ${native.id} has a scheduled '${sc.action}' the SDK does not model. Use provider.raw to handle it.`,
      });
    }
  }

  // Paddle nulls `canceledAt` until the subscription is actually canceled, so
  // — unlike Stripe — no narrowing is needed: a pending at-period-end cancel
  // still has `canceledAt: null` natively.
  const isCanceled = status === 'canceled';

  // Trial end: Paddle carries trial dates on each subscription item
  // (`item.trialDates.{startsAt,endsAt}`). The SDK contract says `trialEnd` is
  // non-null ONLY while the subscription is actively trialing, and null once
  // the trial concludes — use `status === 'trialing'` as the authoritative
  // "currently in a trial" signal (it flips off the moment the trial ends),
  // matching the Stripe normalizer's invariant.
  let trialEnd: Date | null = null;
  if (status === 'trialing') {
    for (const it of native.items) {
      const end = it.trialDates?.endsAt;
      if (end) {
        trialEnd = new Date(end);
        break;
      }
    }
  }

  return {
    id: native.id,
    customerId: native.customerId,
    status,
    items,
    currentPeriodStart,
    currentPeriodEnd,
    trialEnd,
    cancelAtPeriodEnd,
    canceledAt: isCanceled && native.canceledAt ? new Date(native.canceledAt) : null,
    pendingChange,
    metadata: paddleCustomDataToMetadata(native.customData),
    createdAt: new Date(native.createdAt),
    raw: native,
  };
}
