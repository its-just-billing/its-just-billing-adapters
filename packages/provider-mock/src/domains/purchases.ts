import {
  type ProviderPurchase,
  type Purchases,
  Schemas,
  stripReservedKeys,
  validate,
} from '@its-just-billing/provider-sdk';
import { cloneDate } from '../clone-date.js';
import { paginate, sortById } from '../pagination.js';
import type { InternalPurchase, MockState } from '../state.js';

function normalize(p: InternalPurchase): ProviderPurchase {
  return {
    id: p.id,
    customerId: p.customerId,
    status: p.status,
    amount: { amount: p.amount.amount, currency: p.amount.currency },
    amountRefunded: p.amountRefunded
      ? { amount: p.amountRefunded.amount, currency: p.amountRefunded.currency }
      : null,
    priceId: p.priceId,
    productId: p.productId,
    checkoutSessionId: p.checkoutSessionId,
    metadata: stripReservedKeys(p.metadata),
    createdAt: cloneDate(p.createdAt),
  };
}

export function createPurchasesDomain(state: MockState): Purchases {
  return {
    async list(input) {
      const parsed = validate(Schemas.Purchases.PurchasesListInputSchema, input, 'purchases.list');
      let rows = Array.from(state.purchases.values());
      if (parsed?.customerId) rows = rows.filter((p) => p.customerId === parsed.customerId);
      if (parsed?.status) rows = rows.filter((p) => p.status === parsed.status);
      const page = paginate(sortById(rows), parsed?.cursor, parsed?.limit);
      return { data: page.data.map(normalize), nextCursor: page.nextCursor };
    },

    async get(input) {
      const parsed = validate(Schemas.Purchases.PurchasesGetInputSchema, input, 'purchases.get');
      const p = state.purchases.get(parsed.id);
      return p ? normalize(p) : null;
    },
  };
}
