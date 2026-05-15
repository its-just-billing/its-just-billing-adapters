import {
  ProviderConstraintError,
  ProviderNotFoundError,
  type ProviderPayment,
  type ProviderSubscription,
  type RecurringInterval,
  type TrialSpec,
  assertQuantityWithinConstraint,
} from '@its-just-billing/provider-sdk';
import { cloneDate } from './clone-date.js';
import { nextId } from './ids.js';
import type { InternalPayment, InternalSubscription, MockState } from './state.js';

/**
 * Admin operations that bypass the public SDK so the conformance harness can
 * drive flows the public surface doesn't expose (creating a subscription
 * directly, completing a checkout into a payment). Exposed via
 * `provider.admin` on the mock-typed provider.
 */
export interface MockAdmin {
  createSubscription(input: {
    customerId: string;
    priceId: string;
    quantity?: number;
    trial?: TrialSpec;
  }): ProviderSubscription;
  completePayment(input: { checkoutSessionId: string }): ProviderPayment;
  /**
   * Test affordance: end a subscription's trial *now* (early, before its
   * scheduled end). Flips `status` to `'active'`; `trialEnd` becomes null
   * (the cross-provider contract: no `trialEnd` once a subscription is no
   * longer trialing). Emits `subscription.updated` +
   * `subscription.trial_ended`.
   */
  endTrial(input: { id: string }): ProviderSubscription;
  /**
   * Test affordance: emit a `subscription.trial_will_end` event for a
   * trialing subscription. Doesn't change state — just produces the event.
   */
  warnTrialEnding(input: { id: string }): ProviderSubscription;
}

function addInterval(date: Date, interval: RecurringInterval, count: number): Date {
  const d = new Date(date.getTime());
  switch (interval) {
    case 'day':
      d.setUTCDate(d.getUTCDate() + count);
      return d;
    case 'week':
      d.setUTCDate(d.getUTCDate() + 7 * count);
      return d;
    case 'month':
      d.setUTCMonth(d.getUTCMonth() + count);
      return d;
    case 'year':
      d.setUTCFullYear(d.getUTCFullYear() + count);
      return d;
  }
}

function normalizeSubscription(sub: InternalSubscription): ProviderSubscription {
  return {
    id: sub.id,
    customerId: sub.customerId,
    status: sub.status,
    items: sub.items.map((i) => ({ ...i })),
    currentPeriodStart: cloneDate(sub.currentPeriodStart),
    currentPeriodEnd: cloneDate(sub.currentPeriodEnd),
    // Cross-provider contract: `trialEnd` is non-null ONLY while the
    // subscription is actively trialing. Once the trial concludes (status
    // moves off 'trialing') it is null — that's the only shape every
    // provider can satisfy (a provider that nulls trial_end after the trial
    // can't be normalized "up" to a date; one that keeps it, like Stripe,
    // is normalized "down" to null here). Mirrors the Stripe normalizer.
    trialEnd: sub.status === 'trialing' ? cloneDate(sub.trialEnd) : null,
    cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
    canceledAt: cloneDate(sub.canceledAt),
    pendingChange: sub.pendingChange ? { ...sub.pendingChange } : null,
    metadata: { ...sub.metadata },
    createdAt: cloneDate(sub.createdAt),
  };
}

export function createMockAdmin(state: MockState): MockAdmin {
  return {
    createSubscription(input) {
      const customer = state.customers.get(input.customerId);
      if (!customer || customer.archived) {
        throw new ProviderNotFoundError({
          message: `Customer ${input.customerId} not found`,
        });
      }
      const price = state.prices.get(input.priceId);
      if (!price) {
        throw new ProviderNotFoundError({ message: `Price ${input.priceId} not found` });
      }
      if (price.spec.kind !== 'recurring') {
        throw new ProviderConstraintError({
          message: `Price ${price.id} is not recurring; cannot create subscription`,
        });
      }
      const quantity = input.quantity ?? 1;
      assertQuantityWithinConstraint(quantity, price.quantity, 'admin.createSubscription');
      const now = new Date();
      // When a trial is requested, the subscription lands in 'trialing' and
      // `trialEnd` = now + count × unit. Period end remains the next billing
      // boundary measured from `now` (matching Stripe semantics where the
      // period and the trial overlap; the first invoice issues at trial end).
      const trialEnd = input.trial ? addInterval(now, input.trial.unit, input.trial.count) : null;
      const status: InternalSubscription['status'] = trialEnd ? 'trialing' : 'active';
      const sub: InternalSubscription = {
        id: nextId('sub'),
        customerId: customer.id,
        status,
        items: [
          {
            id: `si_mock_${Math.random().toString(36).slice(2, 8)}`,
            priceId: price.id,
            quantity,
          },
        ],
        currentPeriodStart: now,
        currentPeriodEnd: addInterval(now, price.spec.interval, price.spec.intervalCount),
        trialEnd,
        cancelAtPeriodEnd: false,
        canceledAt: null,
        pendingChange: null,
        metadata: {},
        createdAt: now,
      };
      state.subscriptions.set(sub.id, sub);
      const payload = normalizeSubscription(sub);
      state.emit('subscription.created', { kind: 'subscription', id: sub.id }, payload);
      return payload;
    },

    completePayment(input) {
      const session = state.checkoutSessions.get(input.checkoutSessionId);
      if (!session) {
        throw new ProviderNotFoundError({
          message: `Checkout session ${input.checkoutSessionId} not found`,
        });
      }
      const first = session.lineItems[0];
      if (!first) {
        throw new ProviderConstraintError({
          message: `Session ${session.id} has no line items`,
        });
      }
      const price = state.prices.get(first.priceId);
      if (!price) {
        throw new ProviderNotFoundError({
          message: `Price ${first.priceId} not found`,
        });
      }
      const subtotalMinor = session.lineItems.reduce((sum, li) => {
        const p = state.prices.get(li.priceId);
        return sum + (p?.spec.unitAmount ?? 0) * li.quantity;
      }, 0);
      const discountedMinor = session.appliedDiscounts.reduce(
        (sum, d) => sum + d.amountDiscounted.amount,
        0,
      );
      // Cart-level clamp: a session can carry discounts whose nominal total
      // exceeds the subtotal (e.g. two stacked $50-off coupons on a $30 cart).
      // The contract guarantees `amount >= 0`; clamp here.
      const finalAmountMinor = Math.max(0, subtotalMinor - discountedMinor);

      const now = new Date();
      const payment: InternalPayment = {
        id: nextId('pay'),
        customerId: session.customerId,
        status: 'succeeded',
        amount: { amount: finalAmountMinor, currency: price.currency },
        subtotal: { amount: subtotalMinor, currency: price.currency },
        amountRefunded: null,
        appliedDiscounts: session.appliedDiscounts.map((d) => ({
          discountId: d.discountId,
          code: d.code,
          amountDiscounted: { ...d.amountDiscounted },
        })),
        priceId: first.priceId,
        productId: price.productId,
        checkoutSessionId: session.id,
        metadata: {},
        createdAt: now,
      };
      state.payments.set(payment.id, payment);

      // If the session was for a recurring price and carried a trial, also
      // create the corresponding trialing subscription. This is the mock's
      // approximation of what Stripe does in the background when a hosted
      // checkout completes with `subscription_data.trial_period_days`.
      if (price.spec.kind === 'recurring' && session.customerId && session.trial) {
        const trialEnd = addInterval(now, session.trial.unit, session.trial.count);
        const sub: InternalSubscription = {
          id: nextId('sub'),
          customerId: session.customerId,
          status: 'trialing',
          items: session.lineItems.map((li) => ({
            id: `si_mock_${Math.random().toString(36).slice(2, 8)}`,
            priceId: li.priceId,
            quantity: li.quantity,
          })),
          currentPeriodStart: now,
          currentPeriodEnd: addInterval(now, price.spec.interval, price.spec.intervalCount),
          trialEnd,
          cancelAtPeriodEnd: false,
          canceledAt: null,
          pendingChange: null,
          metadata: {},
          createdAt: now,
        };
        state.subscriptions.set(sub.id, sub);
        state.emit(
          'subscription.created',
          { kind: 'subscription', id: sub.id },
          normalizeSubscription(sub),
        );
      }

      session.status = 'complete';

      const payload: ProviderPayment = {
        id: payment.id,
        customerId: payment.customerId,
        status: payment.status,
        amount: { ...payment.amount },
        ...(payment.subtotal !== null ? { subtotal: { ...payment.subtotal } } : {}),
        amountRefunded: null,
        appliedDiscounts: payment.appliedDiscounts.map((d) => ({
          discountId: d.discountId,
          code: d.code,
          amountDiscounted: { ...d.amountDiscounted },
        })),
        priceId: payment.priceId,
        productId: payment.productId,
        checkoutSessionId: payment.checkoutSessionId,
        metadata: {},
        createdAt: cloneDate(payment.createdAt),
      };
      state.emit('payment.created', { kind: 'payment', id: payment.id }, payload);
      state.emit('payment.succeeded', { kind: 'payment', id: payment.id }, payload);
      state.emit(
        'checkout_session.completed',
        { kind: 'checkout_session', id: session.id },
        undefined,
      );
      return payload;
    },

    endTrial(input) {
      const sub = state.subscriptions.get(input.id);
      if (!sub) {
        throw new ProviderNotFoundError({
          message: `Subscription ${input.id} not found`,
        });
      }
      if (sub.status !== 'trialing') {
        throw new ProviderConstraintError({
          message: `Subscription ${input.id} is not in 'trialing' status`,
        });
      }
      sub.status = 'active';
      // Trial concluded. Under the cross-provider contract `trialEnd` is null
      // once a subscription is no longer trialing — `normalizeSubscription`
      // enforces that off `status`, so flipping status is sufficient. (We
      // also clear the internal field so the in-memory store stays honest;
      // a future scheduled date on a non-trialing sub would be meaningless.)
      sub.trialEnd = null;
      const payload = normalizeSubscription(sub);
      state.emit('subscription.updated', { kind: 'subscription', id: sub.id }, payload);
      state.emit('subscription.trial_ended', { kind: 'subscription', id: sub.id }, payload);
      return payload;
    },

    warnTrialEnding(input) {
      const sub = state.subscriptions.get(input.id);
      if (!sub) {
        throw new ProviderNotFoundError({
          message: `Subscription ${input.id} not found`,
        });
      }
      if (sub.status !== 'trialing') {
        throw new ProviderConstraintError({
          message: `Subscription ${input.id} is not in 'trialing' status`,
        });
      }
      const payload = normalizeSubscription(sub);
      state.emit('subscription.trial_will_end', { kind: 'subscription', id: sub.id }, payload);
      return payload;
    },
  };
}
