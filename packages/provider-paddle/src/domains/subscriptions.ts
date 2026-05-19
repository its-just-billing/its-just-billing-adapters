import {
  ProviderConstraintError,
  ProviderNotFoundError,
  ProviderNotSupportedError,
  Schemas,
  type Subscriptions,
  validate,
} from '@its-just-billing/provider-sdk';
import type { Paddle, ProrationBillingMode, Subscription } from '@paddle/paddle-node-sdk';
import { isPaddleMissingReference, mapPaddleError } from '../error-mapping.js';
import { normalizePaddleSubscription } from '../normalize/subscription.js';
import { pageFromPaddleCollection } from '../pagination.js';

/**
 * Map the SDK's `(when, prorationBehavior)` pair onto Paddle's single
 * `prorationBillingMode` enum. `none` proration is `do_not_bill` regardless of
 * timing; `create_prorations` is billed immediately for an immediate change
 * and at the next billing period for an at-period-end change.
 */
function prorationModeFor(
  when: 'immediately' | 'at_period_end' | undefined,
  behavior: 'create_prorations' | 'none' | undefined,
): ProrationBillingMode {
  // `when` / `behavior` carry Zod schema defaults; `validate`'s inferred
  // input type still sees them as optional, so re-apply the schema defaults
  // here (mirrors how the Stripe adapter coalesces `prorationBehavior`).
  if ((behavior ?? 'create_prorations') === 'none') return 'do_not_bill';
  return (when ?? 'immediately') === 'immediately'
    ? 'prorated_immediately'
    : 'prorated_next_billing_period';
}

export function createSubscriptionsDomain(paddle: Paddle): Subscriptions<Subscription> {
  return {
    async list(input) {
      const parsed = validate(
        Schemas.Subscriptions.SubscriptionsListInputSchema,
        input,
        'subscriptions.list',
      );
      // A status with no Paddle equivalent (`unpaid`/`incomplete*`) can never
      // match a Paddle subscription. Return an empty filtered page rather
      // than coercing it to a different status (which would wrongly surface,
      // e.g., canceled subs for a `status: 'unpaid'` query).
      let paddleStatus: PaddleSubscriptionStatus | null | undefined;
      if (parsed.status !== undefined) {
        paddleStatus = paddleStatusOf(parsed.status);
        if (paddleStatus === null) return { data: [], nextCursor: null };
      }
      try {
        const collection = paddle.subscriptions.list({
          customerId: [parsed.customerId],
          ...(parsed.cursor !== undefined ? { after: parsed.cursor } : {}),
          ...(parsed.limit !== undefined ? { perPage: parsed.limit } : {}),
          ...(paddleStatus !== undefined && paddleStatus !== null
            ? { status: [paddleStatus] }
            : {}),
        });
        return await pageFromPaddleCollection(collection, normalizePaddleSubscription);
      } catch (err) {
        // An unknown customer filter is an empty result, not an error — the
        // SDK contract for a filtered list (mirrors Stripe + mock).
        if (isPaddleMissingReference(err)) return { data: [], nextCursor: null };
        throw mapPaddleError(err, 'subscriptions.list');
      }
    },

    async get(input) {
      const parsed = validate(
        Schemas.Subscriptions.SubscriptionsGetInputSchema,
        input,
        'subscriptions.get',
      );
      try {
        const native = await paddle.subscriptions.get(parsed.id);
        return normalizePaddleSubscription(native);
      } catch (err) {
        if (isPaddleMissingReference(err)) return null;
        throw mapPaddleError(err, 'subscriptions.get');
      }
    },

    async cancel(input) {
      const parsed = validate(
        Schemas.Subscriptions.SubscriptionsCancelInputSchema,
        input,
        'subscriptions.cancel',
      );
      try {
        const native = await paddle.subscriptions.cancel(parsed.id, {
          effectiveFrom: parsed.when === 'immediately' ? 'immediately' : 'next_billing_period',
        });
        return normalizePaddleSubscription(native);
      } catch (err) {
        if (isPaddleMissingReference(err)) {
          throw new ProviderNotFoundError({ message: `Subscription ${parsed.id} not found` });
        }
        throw mapPaddleError(err, 'subscriptions.cancel');
      }
    },

    async change(input) {
      const parsed = validate(
        Schemas.Subscriptions.SubscriptionsChangeInputSchema,
        input,
        'subscriptions.change',
      );

      // Paddle cannot defer an item/quantity change: its `scheduled_change`
      // is cancel/pause/resume only and `subscriptions.update` applies items
      // immediately. `when: 'at_period_end'` therefore cannot be honored —
      // reject it (capability `deferredSubscriptionChange: false`) rather
      // than silently applying the change now and lying with
      // `pendingChange: null`, which would alter the customer's subscription
      // before the period ends. Checked pre-API so it's deterministic.
      if (parsed.when === 'at_period_end') {
        throw new ProviderNotSupportedError({
          feature: 'subscription.change.when',
          value: 'at_period_end',
          message:
            'subscriptions.change: Paddle has no deferred item change — apply immediately ' +
            "(when: 'immediately'); see capabilities.deferredSubscriptionChange.",
        });
      }

      // Validate each item before any write: the price must exist, be active,
      // and be recurring. Paddle's `subscriptions.update` would itself reject
      // a non-recurring or archived price, but the SDK contract surfaces these
      // as a typed ProviderConstraintError / ProviderNotFoundError with the
      // offending id, so check up front (mirrors the Stripe adapter).
      for (const item of parsed.items) {
        try {
          const priceNative = await paddle.prices.get(item.priceId);
          if (priceNative.status !== 'active') {
            throw new ProviderConstraintError({
              message: `Price ${item.priceId} is inactive`,
            });
          }
          if (priceNative.billingCycle === null) {
            throw new ProviderConstraintError({
              message: `Price ${item.priceId} is not recurring; cannot attach to a subscription`,
            });
          }
        } catch (err) {
          if (err instanceof ProviderConstraintError) throw err;
          if (isPaddleMissingReference(err)) {
            throw new ProviderNotFoundError({ message: `Price ${item.priceId} not found` });
          }
          throw mapPaddleError(err, 'subscriptions.change');
        }
      }

      // Paddle's `items` replace the current set entirely (the SDK contract:
      // "Items replace the current set entirely"), keyed by `priceId`. Default
      // quantity is 1 when unspecified.
      try {
        const native = await paddle.subscriptions.update(parsed.id, {
          items: parsed.items.map((it) => ({
            priceId: it.priceId,
            quantity: it.quantity ?? 1,
          })),
          prorationBillingMode: prorationModeFor(parsed.when, parsed.prorationBehavior),
        });
        return normalizePaddleSubscription(native);
      } catch (err) {
        if (isPaddleMissingReference(err)) {
          throw new ProviderNotFoundError({ message: `Subscription ${parsed.id} not found` });
        }
        throw mapPaddleError(err, 'subscriptions.change');
      }
    },

    async cancelScheduledChange(input) {
      const parsed = validate(
        Schemas.Subscriptions.SubscriptionsCancelScheduledChangeInputSchema,
        input,
        'subscriptions.cancelScheduledChange',
      );
      // Paddle keeps every pending mutation in a single `scheduledChange`
      // object; clearing it is `update(id, { scheduledChange: null })`.
      // Idempotent — Paddle accepts a null clear even when none is set.
      try {
        const native = await paddle.subscriptions.update(parsed.id, {
          scheduledChange: null,
        });
        return normalizePaddleSubscription(native);
      } catch (err) {
        if (isPaddleMissingReference(err)) {
          throw new ProviderNotFoundError({ message: `Subscription ${parsed.id} not found` });
        }
        throw mapPaddleError(err, 'subscriptions.cancelScheduledChange');
      }
    },
  };
}

type PaddleSubscriptionStatus = 'active' | 'canceled' | 'past_due' | 'paused' | 'trialing';

/**
 * The SDK's normalized `SubscriptionStatus` is a superset of Paddle's. Map
 * the statuses Paddle models; return `null` for the ones it doesn't
 * (`unpaid`/`incomplete*`) so the caller returns an empty filtered page
 * rather than coercing the query to an unrelated status.
 */
function paddleStatusOf(
  status:
    | 'trialing'
    | 'active'
    | 'past_due'
    | 'unpaid'
    | 'canceled'
    | 'incomplete'
    | 'incomplete_expired',
): PaddleSubscriptionStatus | null {
  switch (status) {
    case 'trialing':
      return 'trialing';
    case 'active':
      return 'active';
    case 'past_due':
      return 'past_due';
    case 'canceled':
      return 'canceled';
    default:
      // unpaid / incomplete / incomplete_expired — no Paddle equivalent.
      return null;
  }
}
