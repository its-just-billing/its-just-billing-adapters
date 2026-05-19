import {
  type Products,
  type ProviderCapabilities,
  ProviderNotFoundError,
  ProviderNotSupportedError,
  Schemas,
  assertFeatureEnabled,
  assertNoReservedKeys,
  validate,
} from '@its-just-billing/provider-sdk';
import type { Paddle, Product, UpdateProductRequestBody } from '@paddle/paddle-node-sdk';
import { isPaddleAlreadyArchived, isPaddleNotFound, mapPaddleError } from '../error-mapping.js';
import { normalizePaddleProduct } from '../normalize/product.js';
import { pageFromPaddleCollection } from '../pagination.js';
import { TAX_CATEGORY_TO_PADDLE } from '../tax-codes.js';

export function createProductsDomain(
  paddle: Paddle,
  capabilities: ProviderCapabilities,
): Products<Product> {
  return {
    async list(input) {
      const parsed =
        input !== undefined
          ? validate(Schemas.Products.ProductsListInputSchema, input, 'products.list')
          : undefined;
      try {
        const collection = paddle.products.list({
          ...(parsed?.cursor !== undefined ? { after: parsed.cursor } : {}),
          ...(parsed?.limit !== undefined ? { perPage: parsed.limit } : {}),
          // Paddle's status filter is an array; map the boolean `active`
          // axis onto its two-state `active`/`archived` status.
          ...(parsed?.active !== undefined
            ? { status: [parsed.active ? 'active' : 'archived'] }
            : {}),
        });
        return await pageFromPaddleCollection(collection, normalizePaddleProduct);
      } catch (err) {
        throw mapPaddleError(err, 'products.list');
      }
    },

    async get(input) {
      const parsed = validate(Schemas.Products.ProductsGetInputSchema, input, 'products.get');
      try {
        const native = await paddle.products.get(parsed.id);
        return normalizePaddleProduct(native);
      } catch (err) {
        if (isPaddleNotFound(err)) return null;
        throw mapPaddleError(err, 'products.get');
      }
    },

    async create(input) {
      const parsed = validate(Schemas.Products.ProductsCreateInputSchema, input, 'products.create');
      assertNoReservedKeys(parsed.metadata, 'products.create');
      if (!capabilities.taxCategories.has(parsed.taxCategory)) {
        throw new ProviderNotSupportedError({
          feature: 'taxCategory',
          value: parsed.taxCategory,
          message: `Paddle does not support taxCategory=${parsed.taxCategory}`,
        });
      }
      // Reject a product-level recurrence block: Paddle models recurrence on
      // the price (`recurrenceModel === 'price'`), so this rejects explicitly
      // rather than silently dropping it.
      if (parsed.recurrence !== undefined) {
        assertFeatureEnabled(
          capabilities.recurrenceModel === 'product',
          'product.recurrence',
          'products.create',
        );
      }
      // `description` is validated as `string().min(1).nullable().optional()`
      // at the SDK boundary — by here it's a non-empty string, null, or
      // undefined. Pass through when present; otherwise omit.
      try {
        const native = await paddle.products.create({
          name: parsed.name,
          taxCategory: TAX_CATEGORY_TO_PADDLE[parsed.taxCategory],
          ...(parsed.description !== undefined && parsed.description !== null
            ? { description: parsed.description }
            : {}),
          ...(parsed.metadata !== undefined ? { customData: { ...parsed.metadata } } : {}),
        });
        return normalizePaddleProduct(native);
      } catch (err) {
        throw mapPaddleError(err, 'products.create');
      }
    },

    async update(input) {
      const parsed = validate(Schemas.Products.ProductsUpdateInputSchema, input, 'products.update');
      assertNoReservedKeys(parsed.metadata, 'products.update');
      // Paddle replaces `customData` wholesale (no Stripe-style merge), so the
      // caller's metadata map is sent verbatim with no pre-fetch.
      const body: UpdateProductRequestBody = {
        ...(parsed.name !== undefined ? { name: parsed.name } : {}),
        ...(parsed.description !== undefined ? { description: parsed.description } : {}),
        ...(parsed.metadata !== undefined ? { customData: { ...parsed.metadata } } : {}),
      };
      try {
        const native = await paddle.products.update(parsed.id, body);
        return normalizePaddleProduct(native);
      } catch (err) {
        if (isPaddleNotFound(err)) {
          throw new ProviderNotFoundError({ message: `Product ${parsed.id} not found` });
        }
        throw mapPaddleError(err, 'products.update');
      }
    },

    async deactivate(input) {
      const parsed = validate(
        Schemas.Products.ProductsDeactivateInputSchema,
        input,
        'products.deactivate',
      );
      // Soft-delete = Paddle status `archived`. Paddle has no dedicated
      // archive endpoint for products that flips status the way customers
      // have; `update` with `status: 'archived'` is the documented path.
      try {
        const native = await paddle.products.update(parsed.id, { status: 'archived' });
        return normalizePaddleProduct(native);
      } catch (err) {
        if (isPaddleNotFound(err)) return null;
        // Idempotent: a double deactivate is a no-op per the SDK contract;
        // Paddle rejects re-archiving, so return the current record.
        if (isPaddleAlreadyArchived(err)) {
          const current = await paddle.products.get(parsed.id);
          return normalizePaddleProduct(current);
        }
        throw mapPaddleError(err, 'products.deactivate');
      }
    },

    async activate(input) {
      const parsed = validate(
        Schemas.Products.ProductsActivateInputSchema,
        input,
        'products.activate',
      );
      try {
        const native = await paddle.products.update(parsed.id, { status: 'active' });
        return normalizePaddleProduct(native);
      } catch (err) {
        if (isPaddleNotFound(err)) return null;
        throw mapPaddleError(err, 'products.activate');
      }
    },
  };
}
