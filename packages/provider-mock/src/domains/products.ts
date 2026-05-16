import {
  type Products,
  type ProviderCapabilities,
  ProviderNotFoundError,
  ProviderNotSupportedError,
  type ProviderProduct,
  Schemas,
  assertFeatureEnabled,
  assertNoReservedKeys,
  stripReservedKeys,
  validate,
} from '@its-just-billing/provider-sdk';
import { cloneDate } from '../clone-date.js';
import { nextId } from '../ids.js';
import { paginate, sortById } from '../pagination.js';
import type { InternalProduct, MockState } from '../state.js';

function normalize(p: InternalProduct): ProviderProduct {
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    active: p.active,
    taxCategory: p.taxCategory as ProviderProduct['taxCategory'],
    metadata: stripReservedKeys(p.metadata),
    createdAt: cloneDate(p.createdAt),
    updatedAt: cloneDate(p.updatedAt),
  };
}

export function createProductsDomain(
  state: MockState,
  capabilities: ProviderCapabilities,
): Products {
  return {
    async list(input) {
      const parsed = validate(Schemas.Products.ProductsListInputSchema, input, 'products.list');
      let rows = Array.from(state.products.values());
      if (parsed?.active !== undefined) rows = rows.filter((p) => p.active === parsed.active);
      const page = paginate(sortById(rows), parsed?.cursor, parsed?.limit);
      return { data: page.data.map(normalize), nextCursor: page.nextCursor };
    },

    async get(input) {
      const parsed = validate(Schemas.Products.ProductsGetInputSchema, input, 'products.get');
      const p = state.products.get(parsed.id);
      return p ? normalize(p) : null;
    },

    async create(input) {
      const parsed = validate(Schemas.Products.ProductsCreateInputSchema, input, 'products.create');
      assertNoReservedKeys(parsed.metadata, 'products.create');
      if (!capabilities.taxCategories.has(parsed.taxCategory)) {
        throw new ProviderNotSupportedError({
          feature: 'taxCategory',
          value: parsed.taxCategory,
          message: `mock does not support taxCategory=${parsed.taxCategory}`,
        });
      }
      // The mock models recurrence on the price (productLevelRecurrence ===
      // false), matching Stripe/Paddle. Reject a product-level recurrence
      // block explicitly so the contract is uniform across adapters.
      if (parsed.recurrence !== undefined) {
        assertFeatureEnabled(
          capabilities.features.productLevelRecurrence,
          'product.recurrence',
          'products.create',
        );
      }
      const now = new Date();
      const record: InternalProduct = {
        id: nextId('prod'),
        name: parsed.name,
        description: parsed.description ?? null,
        active: true,
        taxCategory: parsed.taxCategory,
        metadata: { ...(parsed.metadata ?? {}) },
        createdAt: now,
        updatedAt: now,
      };
      state.products.set(record.id, record);
      const out = normalize(record);
      state.emit('product.created', { kind: 'product', id: record.id }, out);
      return out;
    },

    async update(input) {
      const parsed = validate(Schemas.Products.ProductsUpdateInputSchema, input, 'products.update');
      assertNoReservedKeys(parsed.metadata, 'products.update');
      const existing = state.products.get(parsed.id);
      if (!existing) {
        throw new ProviderNotFoundError({ message: `Product ${parsed.id} not found` });
      }
      if (parsed.name !== undefined) existing.name = parsed.name;
      if (parsed.description !== undefined) existing.description = parsed.description;
      if (parsed.metadata !== undefined) existing.metadata = { ...parsed.metadata };
      existing.updatedAt = new Date();
      const out = normalize(existing);
      state.emit('product.updated', { kind: 'product', id: existing.id }, out);
      return out;
    },

    async deactivate(input) {
      const parsed = validate(
        Schemas.Products.ProductsDeactivateInputSchema,
        input,
        'products.deactivate',
      );
      const existing = state.products.get(parsed.id);
      if (!existing) return null;
      const wasActive = existing.active;
      existing.active = false;
      existing.updatedAt = new Date();
      const out = normalize(existing);
      if (wasActive) {
        // `product.archived` collapsed into `product.updated` — consumers are
        // expected to refetch on update events rather than trust payloads, so
        // a dedicated archive-transition event added no information.
        state.emit('product.updated', { kind: 'product', id: existing.id }, out);
      }
      return out;
    },

    async activate(input) {
      const parsed = validate(
        Schemas.Products.ProductsActivateInputSchema,
        input,
        'products.activate',
      );
      const existing = state.products.get(parsed.id);
      if (!existing) return null;
      const wasActive = existing.active;
      existing.active = true;
      existing.updatedAt = new Date();
      const out = normalize(existing);
      if (!wasActive) {
        state.emit('product.updated', { kind: 'product', id: existing.id }, out);
      }
      return out;
    },
  };
}
