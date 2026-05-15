import {
  ProviderConstraintError,
  ProviderNotFoundError,
  type ProviderPurchase,
  type ProviderSubscription,
  type RecurringInterval,
  assertQuantityWithinConstraint,
} from '@its-just-billing/provider-sdk';
import { cloneDate } from './clone-date.js';
import { nextId } from './ids.js';
import type { InternalPurchase, InternalSubscription, MockState } from './state.js';

/**
 * Admin operations that bypass the public SDK so the conformance harness can
 * drive flows the public surface doesn't expose (creating a subscription
 * directly, completing a checkout into a purchase). Exposed via
 * `provider.admin` on the mock-typed provider.
 */
export interface MockAdmin {
  createSubscription(input: {
    customerId: string;
    priceId: string;
    quantity?: number;
  }): ProviderSubscription;
  completePurchase(input: { checkoutSessionId: string }): ProviderPurchase;
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
      const sub: InternalSubscription = {
        id: nextId('sub'),
        customerId: customer.id,
        status: 'active',
        items: [
          {
            id: `si_mock_${Math.random().toString(36).slice(2, 8)}`,
            priceId: price.id,
            quantity,
          },
        ],
        currentPeriodStart: now,
        currentPeriodEnd: addInterval(now, price.spec.interval, price.spec.intervalCount),
        cancelAtPeriodEnd: false,
        canceledAt: null,
        pendingChange: null,
        metadata: {},
        createdAt: now,
      };
      state.subscriptions.set(sub.id, sub);
      const payload: ProviderSubscription = {
        id: sub.id,
        customerId: sub.customerId,
        status: sub.status,
        items: sub.items.map((i) => ({ ...i })),
        currentPeriodStart: cloneDate(sub.currentPeriodStart),
        currentPeriodEnd: cloneDate(sub.currentPeriodEnd),
        cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
        canceledAt: cloneDate(sub.canceledAt),
        pendingChange: null,
        metadata: {},
        createdAt: cloneDate(sub.createdAt),
      };
      state.emit('subscription.created', { kind: 'subscription', id: sub.id }, payload);
      return payload;
    },

    completePurchase(input) {
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
      const amount = session.lineItems.reduce((sum, li) => {
        const p = state.prices.get(li.priceId);
        return sum + (p?.spec.unitAmount ?? 0) * li.quantity;
      }, 0);

      const now = new Date();
      const purchase: InternalPurchase = {
        id: nextId('pur'),
        customerId: session.customerId,
        status: 'succeeded',
        amount: { amount, currency: price.currency },
        amountRefunded: null,
        priceId: first.priceId,
        productId: price.productId,
        checkoutSessionId: session.id,
        metadata: {},
        createdAt: now,
      };
      state.purchases.set(purchase.id, purchase);

      session.status = 'complete';

      const payload: ProviderPurchase = {
        id: purchase.id,
        customerId: purchase.customerId,
        status: purchase.status,
        amount: { ...purchase.amount },
        amountRefunded: null,
        priceId: purchase.priceId,
        productId: purchase.productId,
        checkoutSessionId: purchase.checkoutSessionId,
        metadata: {},
        createdAt: cloneDate(purchase.createdAt),
      };
      state.emit('purchase.created', { kind: 'purchase', id: purchase.id }, payload);
      state.emit('purchase.succeeded', { kind: 'purchase', id: purchase.id }, payload);
      state.emit(
        'checkout_session.completed',
        { kind: 'checkout_session', id: session.id },
        undefined,
      );
      return payload;
    },
  };
}
