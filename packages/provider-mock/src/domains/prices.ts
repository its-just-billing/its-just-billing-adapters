import {
  type Prices,
  type ProviderCapabilities,
  ProviderNotFoundError,
  ProviderNotSupportedError,
  type ProviderPrice,
  Schemas,
  assertCapabilityValueSupported,
  assertFeatureEnabled,
  assertNoReservedKeys,
  defaultQuantityFor,
  stripReservedKeys,
  validate,
} from '@its-just-billing/provider-sdk';
import { cloneDate } from '../clone-date.js';
import { nextId } from '../ids.js';
import { paginate, sortById } from '../pagination.js';
import type { InternalPrice, MockState } from '../state.js';

function normalize(p: InternalPrice): ProviderPrice {
  const base = {
    id: p.id,
    productId: p.productId,
    active: p.active,
    currency: p.currency,
    quantity: { ...p.quantity },
    metadata: stripReservedKeys(p.metadata),
    createdAt: cloneDate(p.createdAt),
    updatedAt: cloneDate(p.updatedAt),
  };
  if (p.spec.kind === 'one_time') {
    return { ...base, kind: 'one_time', unitAmount: p.spec.unitAmount };
  }
  return {
    ...base,
    kind: 'recurring',
    unitAmount: p.spec.unitAmount,
    interval: p.spec.interval,
    intervalCount: p.spec.intervalCount,
  };
}

export function createPricesDomain(state: MockState, capabilities: ProviderCapabilities): Prices {
  return {
    async list(input) {
      const parsed = validate(Schemas.Prices.PricesListInputSchema, input, 'prices.list');
      let rows = Array.from(state.prices.values());
      if (parsed?.productId) rows = rows.filter((p) => p.productId === parsed.productId);
      if (parsed?.active !== undefined) rows = rows.filter((p) => p.active === parsed.active);
      const page = paginate(sortById(rows), parsed?.cursor, parsed?.limit);
      return { data: page.data.map(normalize), nextCursor: page.nextCursor };
    },

    async get(input) {
      const parsed = validate(Schemas.Prices.PricesGetInputSchema, input, 'prices.get');
      const p = state.prices.get(parsed.id);
      return p ? normalize(p) : null;
    },

    async create(input) {
      const parsed = validate(Schemas.Prices.PricesCreateInputSchema, input, 'prices.create');
      assertNoReservedKeys(parsed.metadata, 'prices.create');
      if (!capabilities.currencies.has(parsed.currency)) {
        throw new ProviderNotSupportedError({
          feature: 'currency',
          value: parsed.currency,
          message: `mock does not support currency=${parsed.currency}`,
        });
      }
      if (!state.products.has(parsed.productId)) {
        throw new ProviderNotFoundError({
          message: `Product ${parsed.productId} not found`,
        });
      }
      if (parsed.kind === 'recurring') {
        assertFeatureEnabled(
          capabilities.recurrenceModel === 'price',
          'price.recurrence',
          'prices.create',
        );
        assertCapabilityValueSupported(
          capabilities.recurringIntervals,
          parsed.interval,
          'price.interval',
          'prices.create',
        );
      }
      const now = new Date();
      const spec: InternalPrice['spec'] =
        parsed.kind === 'one_time'
          ? { kind: 'one_time', unitAmount: parsed.unitAmount }
          : {
              kind: 'recurring',
              unitAmount: parsed.unitAmount,
              interval: parsed.interval,
              intervalCount: parsed.intervalCount ?? 1,
            };
      const record: InternalPrice = {
        id: nextId('price'),
        productId: parsed.productId,
        active: true,
        currency: parsed.currency,
        quantity: parsed.quantity ? { ...parsed.quantity } : defaultQuantityFor(parsed.kind),
        metadata: { ...(parsed.metadata ?? {}) },
        createdAt: now,
        updatedAt: now,
        spec,
      };
      state.prices.set(record.id, record);
      const out = normalize(record);
      state.emit('price.created', { kind: 'price', id: record.id }, out);
      return out;
    },

    async update(input) {
      const parsed = validate(Schemas.Prices.PricesUpdateInputSchema, input, 'prices.update');
      assertNoReservedKeys(parsed.metadata, 'prices.update');
      const existing = state.prices.get(parsed.id);
      if (!existing) {
        throw new ProviderNotFoundError({ message: `Price ${parsed.id} not found` });
      }
      if (parsed.metadata !== undefined) existing.metadata = { ...parsed.metadata };
      if (parsed.quantity !== undefined) existing.quantity = { ...parsed.quantity };
      existing.updatedAt = new Date();
      const out = normalize(existing);
      state.emit('price.updated', { kind: 'price', id: existing.id }, out);
      return out;
    },

    async deactivate(input) {
      const parsed = validate(
        Schemas.Prices.PricesDeactivateInputSchema,
        input,
        'prices.deactivate',
      );
      const existing = state.prices.get(parsed.id);
      if (!existing) return null;
      const wasActive = existing.active;
      existing.active = false;
      existing.updatedAt = new Date();
      const out = normalize(existing);
      if (wasActive) {
        // `price.archived` collapsed into `price.updated` — see the matching
        // note in products.ts deactivate.
        state.emit('price.updated', { kind: 'price', id: existing.id }, out);
      }
      return out;
    },

    async activate(input) {
      const parsed = validate(Schemas.Prices.PricesActivateInputSchema, input, 'prices.activate');
      const existing = state.prices.get(parsed.id);
      if (!existing) return null;
      const wasActive = existing.active;
      existing.active = true;
      existing.updatedAt = new Date();
      const out = normalize(existing);
      if (!wasActive) {
        state.emit('price.updated', { kind: 'price', id: existing.id }, out);
      }
      return out;
    },
  };
}
