import {
  ProviderConstraintError,
  ProviderNotFoundError,
  type ProviderSubscription,
  Schemas,
  type Subscriptions,
  assertQuantityWithinConstraint,
  stripReservedKeys,
  validate,
} from '@its-just-billing/provider-sdk';
import { cloneDate } from '../clone-date.js';
import { paginate, sortById } from '../pagination.js';
import type { InternalSubscription, MockState } from '../state.js';

function normalize(s: InternalSubscription): ProviderSubscription {
  return {
    id: s.id,
    customerId: s.customerId,
    status: s.status,
    items: s.items.map((i) => ({ id: i.id, priceId: i.priceId, quantity: i.quantity })),
    currentPeriodStart: cloneDate(s.currentPeriodStart),
    currentPeriodEnd: cloneDate(s.currentPeriodEnd),
    // `trialEnd` is non-null only while actively trialing — null once the
    // trial concludes. The lowest-common-denominator contract across
    // providers (some null trial_end after the trial; we can't fabricate a
    // date for those, so the SDK never promises one post-trial). Mirrors
    // the Stripe normalizer.
    trialEnd: s.status === 'trialing' ? cloneDate(s.trialEnd) : null,
    cancelAtPeriodEnd: s.cancelAtPeriodEnd,
    canceledAt: cloneDate(s.canceledAt),
    pendingChange: s.pendingChange
      ? {
          kind: s.pendingChange.kind,
          ...(s.pendingChange.items ? { items: s.pendingChange.items.map((i) => ({ ...i })) } : {}),
          effectiveAt: cloneDate(s.pendingChange.effectiveAt),
        }
      : null,
    metadata: stripReservedKeys(s.metadata),
    createdAt: cloneDate(s.createdAt),
  };
}

export function createSubscriptionsDomain(state: MockState): Subscriptions {
  return {
    async list(input) {
      const parsed = validate(
        Schemas.Subscriptions.SubscriptionsListInputSchema,
        input,
        'subscriptions.list',
      );
      let rows = Array.from(state.subscriptions.values()).filter(
        (s) => s.customerId === parsed.customerId,
      );
      if (parsed.status) rows = rows.filter((s) => s.status === parsed.status);
      const page = paginate(sortById(rows), parsed.cursor, parsed.limit);
      return { data: page.data.map(normalize), nextCursor: page.nextCursor };
    },

    async get(input) {
      const parsed = validate(
        Schemas.Subscriptions.SubscriptionsGetInputSchema,
        input,
        'subscriptions.get',
      );
      const s = state.subscriptions.get(parsed.id);
      return s ? normalize(s) : null;
    },

    async cancel(input) {
      const parsed = validate(
        Schemas.Subscriptions.SubscriptionsCancelInputSchema,
        input,
        'subscriptions.cancel',
      );
      const existing = state.subscriptions.get(parsed.id);
      if (!existing) {
        throw new ProviderNotFoundError({ message: `Subscription ${parsed.id} not found` });
      }
      if (parsed.when === 'immediately') {
        existing.status = 'canceled';
        existing.canceledAt = new Date();
        existing.cancelAtPeriodEnd = false;
        existing.pendingChange = null;
      } else {
        existing.cancelAtPeriodEnd = true;
        existing.pendingChange = { kind: 'cancel', effectiveAt: existing.currentPeriodEnd };
      }
      const out = normalize(existing);
      const type = parsed.when === 'immediately' ? 'subscription.canceled' : 'subscription.updated';
      state.emit(type, { kind: 'subscription', id: existing.id }, out);
      return out;
    },

    async change(input) {
      const parsed = validate(
        Schemas.Subscriptions.SubscriptionsChangeInputSchema,
        input,
        'subscriptions.change',
      );
      const existing = state.subscriptions.get(parsed.id);
      if (!existing) {
        throw new ProviderNotFoundError({ message: `Subscription ${parsed.id} not found` });
      }
      const items = parsed.items.map((it) => {
        const price = state.prices.get(it.priceId);
        if (!price) {
          throw new ProviderNotFoundError({ message: `Price ${it.priceId} not found` });
        }
        if (!price.active) {
          throw new ProviderConstraintError({
            message: `Price ${price.id} is inactive`,
          });
        }
        if (price.spec.kind !== 'recurring') {
          throw new ProviderConstraintError({
            message: `Price ${price.id} is not recurring; cannot attach to a subscription`,
          });
        }
        const quantity = it.quantity ?? 1;
        assertQuantityWithinConstraint(quantity, price.quantity, 'subscriptions.change');
        return {
          id: `si_mock_${Math.random().toString(36).slice(2, 8)}`,
          priceId: it.priceId,
          quantity,
        };
      });
      // A change() always overrides any previously-scheduled state. If the
      // caller had cancelled at_period_end, that schedule is now replaced by
      // the new price-change schedule (or by an immediate item swap), so
      // cancelAtPeriodEnd must come back to false — otherwise we'd return an
      // inconsistent subscription where the caller can't tell whether the
      // cancellation is still pending.
      existing.cancelAtPeriodEnd = false;
      if (parsed.when === 'at_period_end') {
        existing.pendingChange = {
          kind: 'price_change',
          items: items.map((i) => ({ id: i.id, priceId: i.priceId, quantity: i.quantity })),
          effectiveAt: existing.currentPeriodEnd,
        };
      } else {
        existing.items = items;
        existing.pendingChange = null;
      }
      const out = normalize(existing);
      state.emit('subscription.updated', { kind: 'subscription', id: existing.id }, out);
      return out;
    },

    async cancelScheduledChange(input) {
      const parsed = validate(
        Schemas.Subscriptions.SubscriptionsCancelScheduledChangeInputSchema,
        input,
        'subscriptions.cancelScheduledChange',
      );
      const existing = state.subscriptions.get(parsed.id);
      if (!existing) {
        throw new ProviderNotFoundError({ message: `Subscription ${parsed.id} not found` });
      }
      existing.pendingChange = null;
      existing.cancelAtPeriodEnd = false;
      const out = normalize(existing);
      state.emit('subscription.updated', { kind: 'subscription', id: existing.id }, out);
      return out;
    },
  };
}
