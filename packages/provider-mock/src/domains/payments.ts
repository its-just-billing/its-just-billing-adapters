import {
  type Payments,
  type ProviderPayment,
  Schemas,
  stripReservedKeys,
  validate,
} from '@its-just-billing/provider-sdk';
import { cloneDate } from '../clone-date.js';
import { paginate, sortById } from '../pagination.js';
import type { InternalPayment, MockState } from '../state.js';

function normalize(p: InternalPayment): ProviderPayment {
  return {
    id: p.id,
    customerId: p.customerId,
    status: p.status,
    amount: { amount: p.amount.amount, currency: p.amount.currency },
    ...(p.subtotal !== null
      ? { subtotal: { amount: p.subtotal.amount, currency: p.subtotal.currency } }
      : {}),
    amountRefunded: p.amountRefunded
      ? { amount: p.amountRefunded.amount, currency: p.amountRefunded.currency }
      : null,
    appliedDiscounts: p.appliedDiscounts.map((d) => ({
      discountId: d.discountId,
      code: d.code,
      amountDiscounted: {
        amount: d.amountDiscounted.amount,
        currency: d.amountDiscounted.currency,
      },
    })),
    priceId: p.priceId,
    productId: p.productId,
    checkoutSessionId: p.checkoutSessionId,
    metadata: stripReservedKeys(p.metadata),
    createdAt: cloneDate(p.createdAt),
  };
}

export function createPaymentsDomain(state: MockState): Payments {
  return {
    async list(input) {
      const parsed = validate(Schemas.Payments.PaymentsListInputSchema, input, 'payments.list');
      let rows = Array.from(state.payments.values());
      if (parsed?.customerId) rows = rows.filter((p) => p.customerId === parsed.customerId);
      if (parsed?.status) rows = rows.filter((p) => p.status === parsed.status);
      const page = paginate(sortById(rows), parsed?.cursor, parsed?.limit);
      return { data: page.data.map(normalize), nextCursor: page.nextCursor };
    },

    async get(input) {
      const parsed = validate(Schemas.Payments.PaymentsGetInputSchema, input, 'payments.get');
      const p = state.payments.get(parsed.id);
      return p ? normalize(p) : null;
    },
  };
}
