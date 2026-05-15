import {
  type PendingSubscriptionChange,
  type ProviderSubscription,
  ProviderUnmanagedStateError,
  type SubscriptionItem,
  type SubscriptionStatus,
  stripReservedKeys,
} from '@its-just-billing/provider-sdk';
import type Stripe from 'stripe';
import { fromUnixSeconds } from '../clone-date.js';
import { isSdkAuthoredSchedule } from '../schedule.js';

function statusOf(s: Stripe.Subscription): SubscriptionStatus {
  // Stripe adds 'paused' which the SDK does not model — surface it as an
  // unmanaged-state boundary rather than collapsing into 'active' (which
  // would mis-report billing state).
  if (s.status === 'paused') {
    throw new ProviderUnmanagedStateError({
      field: 'subscription.status',
      expected: 'active|trialing|past_due|unpaid|canceled|incomplete|incomplete_expired',
      found: s.status,
      message: `Subscription ${s.id} is in Stripe's 'paused' state, which the SDK does not model. Use provider.raw to handle it.`,
    });
  }
  return s.status;
}

function customerIdOf(s: Stripe.Subscription): string {
  if (typeof s.customer === 'string') return s.customer;
  if (s.customer && typeof s.customer === 'object') return s.customer.id;
  throw new ProviderUnmanagedStateError({
    field: 'subscription.customer',
    expected: 'a customer reference',
    found: s.customer,
    message: `Subscription ${s.id} has no customer reference`,
  });
}

function priceIdOf(item: Stripe.SubscriptionItem): string {
  const price = item.price;
  if (typeof price === 'string') return price;
  if (price && typeof price === 'object') return price.id;
  throw new ProviderUnmanagedStateError({
    field: 'subscription.items[].price',
    expected: 'a price reference',
    found: price,
    message: `Subscription item ${item.id} has no price reference`,
  });
}

function itemsOf(s: Stripe.Subscription): SubscriptionItem[] {
  return s.items.data.map((it) => ({
    id: it.id,
    priceId: priceIdOf(it),
    quantity: it.quantity ?? 1,
  }));
}

/**
 * Parse the upcoming-phase items of an SDK-authored schedule into the
 * normalized `pendingChange` shape. Phase 0 is the current (already-running)
 * phase; phase 1 onwards is the scheduled change.
 */
function pendingChangeFromSchedule(
  schedule: Stripe.SubscriptionSchedule,
  fallbackEffectiveAt: Date,
): PendingSubscriptionChange | null {
  const phases = schedule.phases ?? [];
  if (phases.length < 2) return null;
  const nextPhase = phases[1];
  if (!nextPhase) return null;
  const items: SubscriptionItem[] = nextPhase.items.map((it, idx) => {
    const price = it.price;
    const priceId =
      typeof price === 'string' ? price : price && typeof price === 'object' ? price.id : null;
    if (!priceId) {
      throw new ProviderUnmanagedStateError({
        field: 'subscription.schedule.phases[].items[].price',
        expected: 'a price reference',
        found: price,
        message: `Schedule ${schedule.id} phase 1 item ${idx} has no price`,
      });
    }
    // Phase items don't carry an id (the SubscriptionItem id is allocated
    // when the phase transitions). Synthesize a stable-ish id from price
    // so the normalized shape has a non-empty `id`.
    return { id: `pending_${priceId}_${idx}`, priceId, quantity: it.quantity ?? 1 };
  });
  const effectiveAt =
    typeof nextPhase.start_date === 'number'
      ? fromUnixSeconds(nextPhase.start_date)
      : fallbackEffectiveAt;
  return { kind: 'price_change', items, effectiveAt };
}

export function normalizeStripeSubscription(
  native: Stripe.Subscription,
): ProviderSubscription<Stripe.Subscription> {
  // Subscription schedule handling:
  //   - No schedule: pendingChange driven by cancel_at_period_end.
  //   - Schedule, SDK-authored: parse phase 1 items into a price_change pending.
  //   - Schedule, not SDK-authored: refuse — fail at the unmanaged-state boundary.
  let scheduleObj: Stripe.SubscriptionSchedule | null = null;
  if (native.schedule !== null && native.schedule !== undefined) {
    if (typeof native.schedule === 'string') {
      // Caller didn't expand `schedule`; we can't tell whether it's SDK-
      // authored. Fail loud — the adapter's read paths expand it for us.
      throw new ProviderUnmanagedStateError({
        field: 'subscription.schedule',
        expected: 'expanded SubscriptionSchedule object',
        found: native.schedule,
        message: `Subscription ${native.id} has a schedule that was not expanded; cannot determine if SDK-authored. Retrieve with expand=['schedule'].`,
      });
    }
    scheduleObj = native.schedule;
    if (!isSdkAuthoredSchedule(scheduleObj.metadata)) {
      throw new ProviderUnmanagedStateError({
        field: 'subscription.schedule',
        expected: 'no schedule, or an SDK-authored schedule',
        found: scheduleObj.id,
        message: `Subscription ${native.id} has a subscription_schedule that the SDK did not author. Use provider.raw to handle it.`,
      });
    }
  }

  const status = statusOf(native);
  const items = itemsOf(native);
  const periodStart = fromUnixSeconds(native.current_period_start);
  const periodEnd = fromUnixSeconds(native.current_period_end);

  // Stripe stamps `canceled_at` the moment cancel is requested (immediate OR
  // at_period_end) and never clears it. The SDK contract is narrower:
  // `canceledAt` is the timestamp when the subscription actually entered the
  // canceled state — i.e. status='canceled'. A pending at_period_end cancel
  // still has `cancelAtPeriodEnd: true` and `canceledAt: null`. Reverting a
  // pending cancel must also clear `canceledAt`.
  const isCanceled = status === 'canceled';

  let pendingChange: PendingSubscriptionChange | null;
  if (native.cancel_at_period_end) {
    pendingChange = { kind: 'cancel', effectiveAt: new Date(periodEnd.getTime()) };
  } else if (scheduleObj) {
    pendingChange = pendingChangeFromSchedule(scheduleObj, periodEnd);
  } else {
    pendingChange = null;
  }

  // Stripe keeps `trial_end` populated forever (even long after the trial
  // ended). The cross-provider SDK contract is narrower: `trialEnd` is
  // non-null ONLY while the subscription is actively trialing, and null once
  // the trial concludes. Rationale: some providers null trial_end after the
  // trial, and the SDK can't fabricate a date for those — so the contract
  // is the intersection ("a future end while trialing, nothing after"), and
  // Stripe normalizes "down" to it. `status === 'trialing'` is Stripe's
  // authoritative "currently in a trial" signal (it flips off 'trialing'
  // the moment the trial ends), which also subsumes the `trial_end < now`
  // check without depending on wall-clock time in the normalizer.
  const trialEnd =
    status === 'trialing' && typeof native.trial_end === 'number'
      ? fromUnixSeconds(native.trial_end)
      : null;

  return {
    id: native.id,
    customerId: customerIdOf(native),
    status,
    items,
    currentPeriodStart: periodStart,
    currentPeriodEnd: periodEnd,
    trialEnd,
    cancelAtPeriodEnd: native.cancel_at_period_end,
    canceledAt:
      isCanceled && native.canceled_at !== null ? fromUnixSeconds(native.canceled_at) : null,
    pendingChange,
    metadata: stripReservedKeys(native.metadata ?? {}),
    createdAt: fromUnixSeconds(native.created),
    raw: native,
  };
}
