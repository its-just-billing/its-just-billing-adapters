import {
  type Customers,
  ProviderNotFoundError,
  Schemas,
  assertNoReservedKeys,
  validate,
} from '@its-just-billing/provider-sdk';
import type Stripe from 'stripe';
import { isStripeNotFound, mapStripeError } from '../error-mapping.js';
import { diffMetadataForReplace } from '../metadata-diff.js';
import { normalizeStripeCustomer } from '../normalize/customer.js';
import { pageFromStripeList } from '../pagination.js';

export function createCustomersDomain(stripe: Stripe): Customers<Stripe.Customer> {
  return {
    async list(input) {
      // `input !== undefined`, not `input ?`: the schema rejects non-object
      // values (null, strings, numbers, bools) per the conformance contract;
      // a truthy check would let `null` slip through to Stripe.
      const parsed =
        input !== undefined
          ? validate(Schemas.Customers.CustomersListInputSchema, input, 'customers.list')
          : undefined;
      try {
        const native = await stripe.customers.list({
          ...(parsed?.cursor !== undefined ? { starting_after: parsed.cursor } : {}),
          ...(parsed?.limit !== undefined ? { limit: parsed.limit } : {}),
          ...(parsed?.email !== undefined ? { email: parsed.email } : {}),
        });
        return pageFromStripeList(native, normalizeStripeCustomer);
      } catch (err) {
        throw mapStripeError(err, 'customers.list');
      }
    },

    async get(input) {
      const parsed = validate(Schemas.Customers.CustomersGetInputSchema, input, 'customers.get');
      try {
        const native = await stripe.customers.retrieve(parsed.id);
        if ('deleted' in native && native.deleted) return null;
        return normalizeStripeCustomer(native);
      } catch (err) {
        if (isStripeNotFound(err)) return null;
        throw mapStripeError(err, 'customers.get');
      }
    },

    async create(input) {
      const parsed = validate(
        Schemas.Customers.CustomersCreateInputSchema,
        input,
        'customers.create',
      );
      assertNoReservedKeys(parsed.metadata, 'customers.create');
      const params: Stripe.CustomerCreateParams = {
        ...(parsed.email !== undefined && parsed.email !== null ? { email: parsed.email } : {}),
        ...(parsed.name !== undefined && parsed.name !== null ? { name: parsed.name } : {}),
        ...(parsed.metadata !== undefined ? { metadata: { ...parsed.metadata } } : {}),
      };
      try {
        const native = await stripe.customers.create(params);
        return normalizeStripeCustomer(native);
      } catch (err) {
        throw mapStripeError(err, 'customers.create');
      }
    },

    async update(input) {
      const parsed = validate(
        Schemas.Customers.CustomersUpdateInputSchema,
        input,
        'customers.update',
      );
      assertNoReservedKeys(parsed.metadata, 'customers.update');
      // Metadata replacement requires a pre-fetch: Stripe merges metadata
      // writes, so to fully replace we have to send empty-string deletes
      // for every existing key not in the new map.
      let metadataParam: Stripe.MetadataParam | undefined;
      if (parsed.metadata !== undefined) {
        try {
          const current = await stripe.customers.retrieve(parsed.id);
          if ('deleted' in current && current.deleted) {
            throw new ProviderNotFoundError({ message: `Customer ${parsed.id} not found` });
          }
          metadataParam = diffMetadataForReplace(parsed.metadata, current.metadata);
        } catch (err) {
          if (isStripeNotFound(err)) {
            throw new ProviderNotFoundError({ message: `Customer ${parsed.id} not found` });
          }
          throw mapStripeError(err, 'customers.update');
        }
      }
      const params: Stripe.CustomerUpdateParams = {
        ...(parsed.email !== undefined ? { email: parsed.email ?? '' } : {}),
        ...(parsed.name !== undefined ? { name: parsed.name ?? '' } : {}),
        ...(metadataParam !== undefined ? { metadata: metadataParam } : {}),
      };
      try {
        const native = await stripe.customers.update(parsed.id, params);
        if ('deleted' in native && native.deleted) {
          throw new ProviderNotFoundError({ message: `Customer ${parsed.id} not found` });
        }
        return normalizeStripeCustomer(native);
      } catch (err) {
        if (isStripeNotFound(err)) {
          throw new ProviderNotFoundError({ message: `Customer ${parsed.id} not found` });
        }
        throw mapStripeError(err, 'customers.update');
      }
    },

    async archive(input) {
      const parsed = validate(
        Schemas.Customers.CustomersArchiveInputSchema,
        input,
        'customers.archive',
      );
      // Snapshot the customer before delete so the normalized return preserves
      // email/name/metadata/createdAt. Stripe's `del` only echoes back
      // { id, object, deleted: true }, which would lose those fields.
      let snapshot: Stripe.Customer;
      try {
        const retrieved = await stripe.customers.retrieve(parsed.id);
        if ('deleted' in retrieved && retrieved.deleted) return null;
        snapshot = retrieved;
      } catch (err) {
        if (isStripeNotFound(err)) return null;
        throw mapStripeError(err, 'customers.archive');
      }
      try {
        await stripe.customers.del(parsed.id);
      } catch (err) {
        if (isStripeNotFound(err)) return null;
        throw mapStripeError(err, 'customers.archive');
      }
      return normalizeStripeCustomer(snapshot);
    },
  };
}
