import {
  type Discounts,
  ProviderConflictError,
  type ProviderDiscount,
  ProviderNotFoundError,
  Schemas,
  assertNoReservedKeys,
  stripReservedKeys,
  validate,
} from '@its-just-billing/provider-sdk';
import { cloneDate } from '../clone-date.js';
import { nextId } from '../ids.js';
import { paginate, sortById } from '../pagination.js';
import type { InternalDiscount, MockState } from '../state.js';

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function normalize(d: InternalDiscount): ProviderDiscount {
  return {
    id: d.id,
    code: d.code,
    benefit: clone(d.benefit),
    duration: clone(d.duration),
    active: d.active,
    expiresAt: cloneDate(d.expiresAt),
    redemptionLimit: d.redemptionLimit,
    redemptionCount: d.redemptionCount,
    restrictedTo: d.restrictedTo ? clone(d.restrictedTo) : null,
    metadata: stripReservedKeys(d.metadata),
    createdAt: cloneDate(d.createdAt),
  };
}

export function createDiscountsDomain(state: MockState): Discounts {
  return {
    async list(input) {
      const parsed = validate(Schemas.Discounts.DiscountsListInputSchema, input, 'discounts.list');
      let rows = Array.from(state.discounts.values());
      if (parsed?.active !== undefined) rows = rows.filter((d) => d.active === parsed.active);
      const page = paginate(sortById(rows), parsed?.cursor, parsed?.limit);
      return { data: page.data.map(normalize), nextCursor: page.nextCursor };
    },

    async get(input) {
      const parsed = validate(Schemas.Discounts.DiscountsGetInputSchema, input, 'discounts.get');
      const d = state.discounts.get(parsed.id);
      return d ? normalize(d) : null;
    },

    async create(input) {
      const parsed = validate(
        Schemas.Discounts.DiscountsCreateInputSchema,
        input,
        'discounts.create',
      );
      assertNoReservedKeys(parsed.metadata, 'discounts.create');
      const code = parsed.code ?? null;
      if (code !== null) {
        for (const existing of state.discounts.values()) {
          if (existing.code === code) {
            throw new ProviderConflictError({
              message: `Discount code "${code}" already exists`,
            });
          }
        }
      }
      const record: InternalDiscount = {
        id: nextId('disc'),
        code,
        benefit: clone(parsed.benefit),
        duration: clone(parsed.duration),
        active: true,
        expiresAt: parsed.expiresAt ?? null,
        redemptionLimit: parsed.redemptionLimit ?? null,
        redemptionCount: 0,
        restrictedTo: parsed.restrictedTo ? clone(parsed.restrictedTo) : null,
        metadata: { ...(parsed.metadata ?? {}) },
        createdAt: new Date(),
      };
      state.discounts.set(record.id, record);
      const out = normalize(record);
      state.emit('discount.created', { kind: 'discount', id: record.id }, out);
      return out;
    },

    async update(input) {
      const parsed = validate(
        Schemas.Discounts.DiscountsUpdateInputSchema,
        input,
        'discounts.update',
      );
      assertNoReservedKeys(parsed.metadata, 'discounts.update');
      const existing = state.discounts.get(parsed.id);
      if (!existing) {
        throw new ProviderNotFoundError({ message: `Discount ${parsed.id} not found` });
      }
      // `expiresAt` is intentionally not in the update schema — expiration is
      // immutable post-create. Zod strips any caller-provided value.
      if (parsed.metadata !== undefined) existing.metadata = { ...parsed.metadata };
      const out = normalize(existing);
      state.emit('discount.updated', { kind: 'discount', id: existing.id }, out);
      return out;
    },

    async deactivate(input) {
      const parsed = validate(
        Schemas.Discounts.DiscountsDeactivateInputSchema,
        input,
        'discounts.deactivate',
      );
      const existing = state.discounts.get(parsed.id);
      if (!existing) return null;
      const wasActive = existing.active;
      existing.active = false;
      const out = normalize(existing);
      if (wasActive) {
        state.emit('discount.archived', { kind: 'discount', id: existing.id }, out);
      }
      return out;
    },

    async activate(input) {
      const parsed = validate(
        Schemas.Discounts.DiscountsActivateInputSchema,
        input,
        'discounts.activate',
      );
      const existing = state.discounts.get(parsed.id);
      if (!existing) return null;
      const wasActive = existing.active;
      existing.active = true;
      const out = normalize(existing);
      if (!wasActive) {
        state.emit('discount.updated', { kind: 'discount', id: existing.id }, out);
      }
      return out;
    },
  };
}
