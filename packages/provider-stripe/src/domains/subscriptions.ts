import {
  ProviderConstraintError,
  ProviderNotFoundError,
  Schemas,
  type Subscriptions,
  assertQuantityWithinConstraint,
  validate,
} from '@its-just-billing/provider-sdk';
import type Stripe from 'stripe';
import { isStripeNotFound, mapStripeError } from '../error-mapping.js';
import { normalizeStripePrice } from '../normalize/price.js';
import { normalizeStripeSubscription } from '../normalize/subscription.js';
import { pageFromStripeList } from '../pagination.js';
import {
  SDK_SCHEDULE_MARKER_KEY,
  SDK_SCHEDULE_MARKER_VALUE,
  isSdkAuthoredSchedule,
} from '../schedule.js';

/**
 * Expand parameters we pass on every subscription retrieve/list. The
 * normalizer requires `schedule` to be a full object (not just an id) so it
 * can detect SDK-authored schedules via the metadata marker.
 */
const RETRIEVE_EXPAND = ['schedule'] as const;
const LIST_EXPAND = ['data.schedule'] as const;

export function createSubscriptionsDomain(stripe: Stripe): Subscriptions<Stripe.Subscription> {
  return {
    async list(input) {
      const parsed = validate(
        Schemas.Subscriptions.SubscriptionsListInputSchema,
        input,
        'subscriptions.list',
      );
      try {
        const native = await stripe.subscriptions.list({
          customer: parsed.customerId,
          expand: [...LIST_EXPAND],
          ...(parsed.cursor !== undefined ? { starting_after: parsed.cursor } : {}),
          ...(parsed.limit !== undefined ? { limit: parsed.limit } : {}),
          ...(parsed.status !== undefined ? { status: parsed.status } : {}),
        });
        return pageFromStripeList(native, normalizeStripeSubscription);
      } catch (err) {
        // Stripe 404s an unknown customer filter; SDK contract: filtered list
        // returns empty, not error. (mock + Paddle don't throw on this either.)
        if (isStripeNotFound(err)) return { data: [], nextCursor: null };
        throw mapStripeError(err, 'subscriptions.list');
      }
    },

    async get(input) {
      const parsed = validate(
        Schemas.Subscriptions.SubscriptionsGetInputSchema,
        input,
        'subscriptions.get',
      );
      try {
        const native = await stripe.subscriptions.retrieve(parsed.id, {
          expand: [...RETRIEVE_EXPAND],
        });
        return normalizeStripeSubscription(native);
      } catch (err) {
        if (isStripeNotFound(err)) return null;
        throw mapStripeError(err, 'subscriptions.get');
      }
    },

    async cancel(input) {
      const parsed = validate(
        Schemas.Subscriptions.SubscriptionsCancelInputSchema,
        input,
        'subscriptions.cancel',
      );
      try {
        if (parsed.when === 'immediately') {
          // Release any SDK-authored schedule before canceling — otherwise
          // Stripe rejects `subscriptions.cancel` on a sub still under a
          // schedule, and a stale schedule would also confuse the normalizer
          // on subsequent reads.
          await releaseSdkScheduleIfPresent(stripe, parsed.id);
          const native = await stripe.subscriptions.cancel(parsed.id, {
            expand: [...RETRIEVE_EXPAND],
          });
          return normalizeStripeSubscription(native);
        }
        const native = await stripe.subscriptions.update(parsed.id, {
          cancel_at_period_end: true,
          expand: [...RETRIEVE_EXPAND],
        });
        return normalizeStripeSubscription(native);
      } catch (err) {
        if (isStripeNotFound(err)) {
          throw new ProviderNotFoundError({ message: `Subscription ${parsed.id} not found` });
        }
        throw mapStripeError(err, 'subscriptions.cancel');
      }
    },

    async change(input) {
      const parsed = validate(
        Schemas.Subscriptions.SubscriptionsChangeInputSchema,
        input,
        'subscriptions.change',
      );

      // Validate each item before any write: price exists, is active, is
      // recurring, and quantity is within constraint. Mirrors mock + Paddle.
      const validatedItems: { priceId: string; quantity: number }[] = [];
      for (const item of parsed.items) {
        let priceNative: Stripe.Price;
        try {
          priceNative = await stripe.prices.retrieve(item.priceId);
        } catch (err) {
          if (isStripeNotFound(err)) {
            throw new ProviderNotFoundError({ message: `Price ${item.priceId} not found` });
          }
          throw mapStripeError(err, 'subscriptions.change');
        }
        if (!priceNative.active) {
          throw new ProviderConstraintError({ message: `Price ${priceNative.id} is inactive` });
        }
        const price = normalizeStripePrice(priceNative);
        if (price.kind !== 'recurring') {
          throw new ProviderConstraintError({
            message: `Price ${price.id} is not recurring; cannot attach to a subscription`,
          });
        }
        const quantity = item.quantity ?? 1;
        assertQuantityWithinConstraint(quantity, price.quantity, 'subscriptions.change');
        validatedItems.push({ priceId: item.priceId, quantity });
      }

      if (parsed.when === 'at_period_end') {
        return await scheduleChangeAtPeriodEnd(stripe, parsed.id, validatedItems);
      }

      // Immediate change. Fetch existing items so removed ones get
      // `deleted: true` and preserved ones keep their item identity.
      let existing: Stripe.Subscription;
      try {
        existing = await stripe.subscriptions.retrieve(parsed.id, {
          expand: [...RETRIEVE_EXPAND],
        });
      } catch (err) {
        if (isStripeNotFound(err)) {
          throw new ProviderNotFoundError({ message: `Subscription ${parsed.id} not found` });
        }
        throw mapStripeError(err, 'subscriptions.change');
      }

      // If an SDK-authored schedule exists, release it first so the immediate
      // change doesn't conflict with future phases. Non-SDK schedules already
      // fail normalization above when `existing` was retrieved.
      if (
        existing.schedule &&
        typeof existing.schedule === 'object' &&
        isSdkAuthoredSchedule(existing.schedule.metadata)
      ) {
        try {
          await stripe.subscriptionSchedules.release(existing.schedule.id);
        } catch (err) {
          if (!isAlreadyReleasedOrCanceled(err)) {
            throw mapStripeError(err, 'subscriptions.change');
          }
        }
      }

      const desiredPriceIds = new Set(validatedItems.map((it) => it.priceId));
      const updates: Stripe.SubscriptionUpdateParams.Item[] = [];
      const existingByPrice = new Map<string, Stripe.SubscriptionItem>();
      for (const it of existing.items.data) {
        const priceId = typeof it.price === 'string' ? it.price : it.price.id;
        existingByPrice.set(priceId, it);
      }
      for (const item of validatedItems) {
        const match = existingByPrice.get(item.priceId);
        if (match) {
          updates.push({ id: match.id, price: item.priceId, quantity: item.quantity });
        } else {
          updates.push({ price: item.priceId, quantity: item.quantity });
        }
      }
      for (const it of existing.items.data) {
        const priceId = typeof it.price === 'string' ? it.price : it.price.id;
        if (!desiredPriceIds.has(priceId)) {
          updates.push({ id: it.id, deleted: true });
        }
      }

      try {
        const native = await stripe.subscriptions.update(parsed.id, {
          items: updates,
          proration_behavior: parsed.prorationBehavior ?? 'create_prorations',
          cancel_at_period_end: false,
          expand: [...RETRIEVE_EXPAND],
        });
        return normalizeStripeSubscription(native);
      } catch (err) {
        if (isStripeNotFound(err)) {
          throw new ProviderNotFoundError({ message: `Subscription ${parsed.id} not found` });
        }
        throw mapStripeError(err, 'subscriptions.change');
      }
    },

    async cancelScheduledChange(input) {
      const parsed = validate(
        Schemas.Subscriptions.SubscriptionsCancelScheduledChangeInputSchema,
        input,
        'subscriptions.cancelScheduledChange',
      );
      let existing: Stripe.Subscription;
      try {
        existing = await stripe.subscriptions.retrieve(parsed.id, {
          expand: [...RETRIEVE_EXPAND],
        });
      } catch (err) {
        if (isStripeNotFound(err)) {
          throw new ProviderNotFoundError({ message: `Subscription ${parsed.id} not found` });
        }
        throw mapStripeError(err, 'subscriptions.cancelScheduledChange');
      }

      // Two scheduled-change shapes the SDK might have authored:
      //   1. cancel_at_period_end=true (a pending cancel).
      //   2. SDK-authored subscription_schedule (a pending price_change).
      // Both need to be cleared. Idempotent if neither is set.
      if (
        existing.schedule &&
        typeof existing.schedule === 'object' &&
        isSdkAuthoredSchedule(existing.schedule.metadata)
      ) {
        try {
          await stripe.subscriptionSchedules.release(existing.schedule.id);
        } catch (err) {
          if (!isAlreadyReleasedOrCanceled(err)) {
            throw mapStripeError(err, 'subscriptions.cancelScheduledChange');
          }
        }
      }
      try {
        const native = await stripe.subscriptions.update(parsed.id, {
          cancel_at_period_end: false,
          expand: [...RETRIEVE_EXPAND],
        });
        return normalizeStripeSubscription(native);
      } catch (err) {
        throw mapStripeError(err, 'subscriptions.cancelScheduledChange');
      }
    },
  };
}

/**
 * Author a Stripe SubscriptionSchedule that switches the subscription to
 * `newItems` at the end of the current billing period. Phase 0 mirrors the
 * sub's current items; phase 1 is the new items, with `end_behavior: release`
 * so the subscription continues normally after the schedule's last phase.
 *
 * The schedule is tagged with {@link SDK_SCHEDULE_MARKER_KEY} so the
 * normalizer recognizes it on read; schedules without the marker are treated
 * as unmanaged state and surface as `ProviderUnmanagedStateError`.
 */
async function scheduleChangeAtPeriodEnd(
  stripe: Stripe,
  subId: string,
  newItems: { priceId: string; quantity: number }[],
) {
  let existing: Stripe.Subscription;
  try {
    existing = await stripe.subscriptions.retrieve(subId, { expand: [...RETRIEVE_EXPAND] });
  } catch (err) {
    if (isStripeNotFound(err)) {
      throw new ProviderNotFoundError({ message: `Subscription ${subId} not found` });
    }
    throw mapStripeError(err, 'subscriptions.change');
  }

  // If a non-SDK schedule already exists, refuse — the normalizer would too.
  if (
    existing.schedule &&
    typeof existing.schedule === 'object' &&
    !isSdkAuthoredSchedule(existing.schedule.metadata)
  ) {
    throw new ProviderConstraintError({
      message: `Subscription ${subId} has a subscription_schedule the SDK did not author; cannot schedule a change. Use provider.raw to manage it.`,
    });
  }

  // Either reuse our existing schedule (overwriting phase 1) or create one.
  let scheduleId: string;
  let phase0: Stripe.SubscriptionScheduleUpdateParams.Phase;
  if (
    existing.schedule &&
    typeof existing.schedule === 'object' &&
    isSdkAuthoredSchedule(existing.schedule.metadata)
  ) {
    scheduleId = existing.schedule.id;
    phase0 = toUpdatePhase(existing.schedule.phases[0]);
  } else {
    let created: Stripe.SubscriptionSchedule;
    try {
      created = await stripe.subscriptionSchedules.create({
        from_subscription: subId,
      });
    } catch (err) {
      throw mapStripeError(err, 'subscriptions.change');
    }
    scheduleId = created.id;
    phase0 = toUpdatePhase(created.phases[0]);
  }

  // The conformance contract says `change(at_period_end)` schedules phase 1
  // to take effect at the subscription's `currentPeriodEnd`. Stripe's
  // auto-populated phase 0 (from `from_subscription`) generally ends one
  // billing cycle past trial — for a trialing sub that's trial_end + 1 month,
  // not trial_end. Override phase 0's end_date so phase 1's start_date lines
  // up exactly with the sub's currentPeriodEnd.
  phase0 = { ...phase0, end_date: existing.current_period_end };

  const nextPhase: Stripe.SubscriptionScheduleUpdateParams.Phase = {
    items: newItems.map((it) => ({ price: it.priceId, quantity: it.quantity })),
    iterations: 1,
  };

  try {
    await stripe.subscriptionSchedules.update(scheduleId, {
      phases: [phase0, nextPhase],
      end_behavior: 'release',
      metadata: { [SDK_SCHEDULE_MARKER_KEY]: SDK_SCHEDULE_MARKER_VALUE },
    });
  } catch (err) {
    throw mapStripeError(err, 'subscriptions.change');
  }

  // Re-fetch the subscription with the schedule expanded so the normalizer
  // can produce `pendingChange` from phase 1.
  try {
    const fresh = await stripe.subscriptions.retrieve(subId, {
      expand: [...RETRIEVE_EXPAND],
    });
    return normalizeStripeSubscription(fresh);
  } catch (err) {
    throw mapStripeError(err, 'subscriptions.change');
  }
}

/**
 * Best-effort release of an SDK-authored schedule on a subscription. Used by
 * `subscriptions.cancel(when='immediately')` to clean up any pending price
 * change before terminating the subscription. Swallows "already released" /
 * "already canceled" errors so the parent cancel still proceeds.
 */
async function releaseSdkScheduleIfPresent(stripe: Stripe, subId: string): Promise<void> {
  let existing: Stripe.Subscription;
  try {
    existing = await stripe.subscriptions.retrieve(subId, { expand: [...RETRIEVE_EXPAND] });
  } catch {
    // Caller is about to cancel — if retrieve fails, let cancel surface the
    // real error (404, auth, etc.) rather than masking it here.
    return;
  }
  if (
    !existing.schedule ||
    typeof existing.schedule !== 'object' ||
    !isSdkAuthoredSchedule(existing.schedule.metadata)
  ) {
    return;
  }
  try {
    await stripe.subscriptionSchedules.release(existing.schedule.id);
  } catch (err) {
    if (!isAlreadyReleasedOrCanceled(err)) throw mapStripeError(err, 'subscriptions.cancel');
  }
}

/**
 * Stripe rejects release/cancel on a schedule that's already in `released` or
 * `canceled` state with a 400. From the SDK's perspective this is success —
 * the resource is gone — so swallow it. Anything else (auth, 5xx) propagates.
 */
function isAlreadyReleasedOrCanceled(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message ?? '';
  return msg.includes('already released') || msg.includes('already canceled');
}

/**
 * Translate a phase as returned by the API into the params shape used for
 * updates. Stripe's read shape and write shape differ: read uses richer types
 * (e.g. expanded objects), but `update` needs primitive ids. Trial info on
 * the existing phase must round-trip — losing it shifts every downstream
 * date by the trial duration.
 */
function toUpdatePhase(
  phase: Stripe.SubscriptionSchedule.Phase | undefined,
): Stripe.SubscriptionScheduleUpdateParams.Phase {
  if (!phase) {
    throw new ProviderConstraintError({
      message: 'Stripe returned a subscription schedule with no phases — cannot schedule change',
    });
  }
  return {
    items: phase.items.map((it) => {
      const price = it.price;
      const priceId = typeof price === 'string' ? price : price.id;
      return {
        price: priceId,
        ...(typeof it.quantity === 'number' ? { quantity: it.quantity } : {}),
      };
    }),
    start_date: phase.start_date,
    end_date: phase.end_date,
    ...(typeof phase.trial_end === 'number' ? { trial_end: phase.trial_end } : {}),
  };
}
