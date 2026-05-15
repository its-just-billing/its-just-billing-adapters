import {
  type Customers,
  type ProviderCustomer,
  ProviderNotFoundError,
  Schemas,
  assertNoReservedKeys,
  stripReservedKeys,
  validate,
} from '@its-just-billing/provider-sdk';
import { cloneDate } from '../clone-date.js';
import { nextId } from '../ids.js';
import { paginate, sortById } from '../pagination.js';
import type { InternalCustomer, MockState } from '../state.js';

function normalize(c: InternalCustomer): ProviderCustomer {
  return {
    id: c.id,
    email: c.email,
    name: c.name,
    metadata: stripReservedKeys(c.metadata),
    createdAt: cloneDate(c.createdAt),
  };
}

export function createCustomersDomain(state: MockState): Customers {
  return {
    async list(input) {
      const parsed = validate(Schemas.Customers.CustomersListInputSchema, input, 'customers.list');
      const all = Array.from(state.customers.values()).filter((c) => !c.archived);
      let filtered = all;
      if (parsed?.email) filtered = filtered.filter((c) => c.email === parsed.email);
      const sorted = sortById(filtered);
      const page = paginate(sorted, parsed?.cursor, parsed?.limit);
      return { data: page.data.map(normalize), nextCursor: page.nextCursor };
    },

    async get(input) {
      const parsed = validate(Schemas.Customers.CustomersGetInputSchema, input, 'customers.get');
      const c = state.customers.get(parsed.id);
      if (!c || c.archived) return null;
      return normalize(c);
    },

    async create(input) {
      const parsed = validate(
        Schemas.Customers.CustomersCreateInputSchema,
        input,
        'customers.create',
      );
      assertNoReservedKeys(parsed.metadata, 'customers.create');
      const record: InternalCustomer = {
        id: nextId('cus'),
        email: parsed.email ?? null,
        name: parsed.name ?? null,
        metadata: { ...(parsed.metadata ?? {}) },
        createdAt: new Date(),
        archived: false,
      };
      state.customers.set(record.id, record);
      const out = normalize(record);
      state.emit('customer.created', { kind: 'customer', id: record.id }, out);
      return out;
    },

    async update(input) {
      const parsed = validate(
        Schemas.Customers.CustomersUpdateInputSchema,
        input,
        'customers.update',
      );
      assertNoReservedKeys(parsed.metadata, 'customers.update');
      const existing = state.customers.get(parsed.id);
      if (!existing || existing.archived) {
        throw new ProviderNotFoundError({ message: `Customer ${parsed.id} not found` });
      }
      if (parsed.email !== undefined) existing.email = parsed.email;
      if (parsed.name !== undefined) existing.name = parsed.name;
      if (parsed.metadata !== undefined) existing.metadata = { ...parsed.metadata };
      const out = normalize(existing);
      state.emit('customer.updated', { kind: 'customer', id: existing.id }, out);
      return out;
    },

    async archive(input) {
      const parsed = validate(
        Schemas.Customers.CustomersArchiveInputSchema,
        input,
        'customers.archive',
      );
      const existing = state.customers.get(parsed.id);
      if (!existing) return null;
      const wasArchived = existing.archived;
      existing.archived = true;
      const out = normalize(existing);
      if (!wasArchived) {
        state.emit('customer.deleted', { kind: 'customer', id: existing.id }, out);
      }
      return out;
    },
  };
}
