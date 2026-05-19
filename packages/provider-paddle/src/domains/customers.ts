import {
  type Customers,
  ProviderNotFoundError,
  ProviderNotSupportedError,
  Schemas,
  assertNoReservedKeys,
  validate,
} from '@its-just-billing/provider-sdk';
import type { Customer, Paddle, UpdateCustomerRequestBody } from '@paddle/paddle-node-sdk';
import { isPaddleAlreadyArchived, isPaddleNotFound, mapPaddleError } from '../error-mapping.js';
import { normalizePaddleCustomer } from '../normalize/customer.js';
import { pageFromPaddleCollection } from '../pagination.js';

export function createCustomersDomain(paddle: Paddle): Customers<Customer> {
  return {
    async list(input) {
      // `input !== undefined`, not `input ?`: the schema rejects non-object
      // values (null, strings, numbers, bools) per the conformance contract;
      // a truthy check would let `null` slip through to Paddle.
      const parsed =
        input !== undefined
          ? validate(Schemas.Customers.CustomersListInputSchema, input, 'customers.list')
          : undefined;
      try {
        const collection = paddle.customers.list({
          ...(parsed?.cursor !== undefined ? { after: parsed.cursor } : {}),
          ...(parsed?.limit !== undefined ? { perPage: parsed.limit } : {}),
          ...(parsed?.email !== undefined ? { email: [parsed.email] } : {}),
        });
        return await pageFromPaddleCollection(collection, normalizePaddleCustomer);
      } catch (err) {
        throw mapPaddleError(err, 'customers.list');
      }
    },

    async get(input) {
      const parsed = validate(Schemas.Customers.CustomersGetInputSchema, input, 'customers.get');
      try {
        const native = await paddle.customers.get(parsed.id);
        return normalizePaddleCustomer(native);
      } catch (err) {
        if (isPaddleNotFound(err)) return null;
        throw mapPaddleError(err, 'customers.get');
      }
    },

    async create(input) {
      const parsed = validate(
        Schemas.Customers.CustomersCreateInputSchema,
        input,
        'customers.create',
      );
      assertNoReservedKeys(parsed.metadata, 'customers.create');
      // Paddle mandates a non-null email. Reject a missing one (capability
      // `emailRequired: true`) rather than fabricating a dead address —
      // faking it would silently send receipts/dunning into the void.
      if (parsed.email === undefined || parsed.email === null) {
        throw new ProviderNotSupportedError({
          feature: 'customer.email',
          value: 'null',
          message:
            'customers.create: Paddle requires a non-null customer email (capabilities.emailRequired)',
        });
      }
      try {
        const native = await paddle.customers.create({
          email: parsed.email,
          ...(parsed.name !== undefined && parsed.name !== null ? { name: parsed.name } : {}),
          ...(parsed.metadata !== undefined ? { customData: { ...parsed.metadata } } : {}),
        });
        return normalizePaddleCustomer(native);
      } catch (err) {
        throw mapPaddleError(err, 'customers.create');
      }
    },

    async update(input) {
      const parsed = validate(
        Schemas.Customers.CustomersUpdateInputSchema,
        input,
        'customers.update',
      );
      assertNoReservedKeys(parsed.metadata, 'customers.update');
      // Paddle replaces `customData` wholesale (no merge semantics), so —
      // unlike Stripe — there is no pre-fetch / empty-string-delete dance:
      // the caller's metadata map is sent verbatim.
      //
      // email: a string sets it; `undefined` leaves it untouched; explicit
      // `null` ("clear it") is rejected — Paddle mandates an email, and
      // faking a placeholder would be a silent production footgun.
      if (parsed.email === null) {
        throw new ProviderNotSupportedError({
          feature: 'customer.email',
          value: 'null',
          message:
            'customers.update: Paddle requires a non-null customer email; it cannot be cleared (capabilities.emailRequired)',
        });
      }
      const body: UpdateCustomerRequestBody = {
        ...(parsed.email !== undefined ? { email: parsed.email } : {}),
        ...(parsed.name !== undefined ? { name: parsed.name } : {}),
        ...(parsed.metadata !== undefined ? { customData: { ...parsed.metadata } } : {}),
      };
      try {
        const native = await paddle.customers.update(parsed.id, body);
        return normalizePaddleCustomer(native);
      } catch (err) {
        if (isPaddleNotFound(err)) {
          throw new ProviderNotFoundError({ message: `Customer ${parsed.id} not found` });
        }
        throw mapPaddleError(err, 'customers.update');
      }
    },

    async archive(input) {
      const parsed = validate(
        Schemas.Customers.CustomersArchiveInputSchema,
        input,
        'customers.archive',
      );
      // Paddle's `archive` soft-deletes (sets status=archived) and echoes
      // back the full customer with email/name/customData intact — so, unlike
      // Stripe's `del`, no pre-fetch snapshot is needed to preserve fields.
      try {
        const native = await paddle.customers.archive(parsed.id);
        return normalizePaddleCustomer(native);
      } catch (err) {
        if (isPaddleNotFound(err)) return null;
        // Idempotent: a second archive on an already-archived customer is a
        // no-op per the SDK contract; Paddle rejects re-archiving, so return
        // the current (already-archived) record.
        if (isPaddleAlreadyArchived(err)) {
          const current = await paddle.customers.get(parsed.id);
          return normalizePaddleCustomer(current);
        }
        throw mapPaddleError(err, 'customers.archive');
      }
    },
  };
}
