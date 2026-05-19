import {
  type Prices,
  type ProviderCapabilities,
  ProviderNotFoundError,
  ProviderNotSupportedError,
  Schemas,
  assertCapabilityValueSupported,
  assertFeatureEnabled,
  assertNoReservedKeys,
  defaultQuantityFor,
  validate,
} from '@its-just-billing/provider-sdk';
import type {
  CreatePriceRequestBody,
  CurrencyCode,
  Paddle,
  Price,
  UpdatePriceRequestBody,
} from '@paddle/paddle-node-sdk';
import {
  isPaddleAlreadyArchived,
  isPaddleNotFound,
  isPaddleProductNotFound,
  mapPaddleError,
} from '../error-mapping.js';
import { PADDLE_UNBOUNDED_QUANTITY_MAX, normalizePaddlePrice } from '../normalize/price.js';
import { pageFromPaddleCollection } from '../pagination.js';

export function createPricesDomain(
  paddle: Paddle,
  capabilities: ProviderCapabilities,
): Prices<Price> {
  return {
    async list(input) {
      const parsed =
        input !== undefined
          ? validate(Schemas.Prices.PricesListInputSchema, input, 'prices.list')
          : undefined;
      try {
        const collection = paddle.prices.list({
          ...(parsed?.cursor !== undefined ? { after: parsed.cursor } : {}),
          ...(parsed?.limit !== undefined ? { perPage: parsed.limit } : {}),
          ...(parsed?.productId !== undefined ? { productId: [parsed.productId] } : {}),
          ...(parsed?.active !== undefined
            ? { status: [parsed.active ? 'active' : 'archived'] }
            : {}),
        });
        return await pageFromPaddleCollection(collection, normalizePaddlePrice);
      } catch (err) {
        throw mapPaddleError(err, 'prices.list');
      }
    },

    async get(input) {
      const parsed = validate(Schemas.Prices.PricesGetInputSchema, input, 'prices.get');
      try {
        const native = await paddle.prices.get(parsed.id);
        return normalizePaddlePrice(native);
      } catch (err) {
        if (isPaddleNotFound(err)) return null;
        throw mapPaddleError(err, 'prices.get');
      }
    },

    async create(input) {
      const parsed = validate(Schemas.Prices.PricesCreateInputSchema, input, 'prices.create');
      assertNoReservedKeys(parsed.metadata, 'prices.create');
      if (!capabilities.currencies.has(parsed.currency)) {
        throw new ProviderNotSupportedError({
          feature: 'currency',
          value: parsed.currency,
          message: `Paddle does not support currency=${parsed.currency}`,
        });
      }
      if (parsed.kind === 'recurring') {
        // Reject a recurring price unless this provider models recurrence on
        // the price (Paddle is `'price'`, so this passes).
        assertFeatureEnabled(
          capabilities.recurrenceModel === 'price',
          'price.recurrence',
          'prices.create',
        );
        // Reject a recurring interval the provider can't honor.
        assertCapabilityValueSupported(
          capabilities.recurringIntervals,
          parsed.interval,
          'price.interval',
          'prices.create',
        );
      }
      // Quantity is first-class on a Paddle price (enforced natively), so it
      // goes onto the request body rather than into reserved metadata. The
      // SDK's `Quantity` has an optional `max`; Paddle's `quantity.maximum`
      // is required, so an unbounded SDK quantity is materialized with
      // Paddle's documented per-line maximum.
      const quantity = parsed.quantity ?? defaultQuantityFor(parsed.kind);
      // Paddle's `unitPrice.currencyCode` is the uppercase ISO-4217 enum; the
      // SDK currency is lowercased — re-uppercase for the request body.
      const body: CreatePriceRequestBody = {
        productId: parsed.productId,
        description: parsed.metadata?.description ?? 'price',
        unitPrice: {
          amount: String(parsed.unitAmount),
          currencyCode: parsed.currency.toUpperCase() as CurrencyCode,
        },
        quantity: {
          minimum: quantity.min,
          maximum: quantity.max ?? PADDLE_UNBOUNDED_QUANTITY_MAX,
        },
        ...(parsed.kind === 'recurring'
          ? {
              billingCycle: {
                interval: parsed.interval,
                frequency: parsed.intervalCount ?? 1,
              },
            }
          : {}),
        ...(parsed.metadata !== undefined ? { customData: { ...parsed.metadata } } : {}),
      };
      try {
        const native = await paddle.prices.create(body);
        return normalizePaddlePrice(native);
      } catch (err) {
        // An unknown/ill-formed `productId` is a not-found per the SDK
        // contract (the conformance passes a bogus product id expecting 404);
        // Paddle reports it as a `product_id` field/route error.
        if (isPaddleProductNotFound(err)) {
          throw new ProviderNotFoundError({
            message: `prices.create: product ${parsed.productId} not found`,
          });
        }
        throw mapPaddleError(err, 'prices.create');
      }
    },

    async update(input) {
      const parsed = validate(Schemas.Prices.PricesUpdateInputSchema, input, 'prices.update');
      assertNoReservedKeys(parsed.metadata, 'prices.update');
      // The SDK update schema only admits `metadata` and `quantity` — the
      // immutable fields (currency, kind, recurring shape) are not even
      // representable in the input, so a constraint violation can only arise
      // from a malformed quantity, which the schema's refine already rejects.
      // Paddle's quantity is native and replaced wholesale; metadata
      // (`customData`) is likewise replaced wholesale (no Stripe merge), so
      // no pre-fetch is needed.
      const body: UpdatePriceRequestBody = {
        ...(parsed.metadata !== undefined ? { customData: { ...parsed.metadata } } : {}),
        ...(parsed.quantity !== undefined
          ? {
              quantity: {
                minimum: parsed.quantity.min,
                maximum: parsed.quantity.max ?? PADDLE_UNBOUNDED_QUANTITY_MAX,
              },
            }
          : {}),
      };
      if (Object.keys(body).length === 0) {
        // Nothing mutable supplied. Treat as a no-op read so the normalized
        // return still reflects current provider state.
        try {
          const current = await paddle.prices.get(parsed.id);
          return normalizePaddlePrice(current);
        } catch (err) {
          if (isPaddleNotFound(err)) {
            throw new ProviderNotFoundError({ message: `Price ${parsed.id} not found` });
          }
          throw mapPaddleError(err, 'prices.update');
        }
      }
      try {
        const native = await paddle.prices.update(parsed.id, body);
        return normalizePaddlePrice(native);
      } catch (err) {
        if (isPaddleNotFound(err)) {
          throw new ProviderNotFoundError({ message: `Price ${parsed.id} not found` });
        }
        throw mapPaddleError(err, 'prices.update');
      }
    },

    async deactivate(input) {
      const parsed = validate(
        Schemas.Prices.PricesDeactivateInputSchema,
        input,
        'prices.deactivate',
      );
      try {
        const native = await paddle.prices.update(parsed.id, { status: 'archived' });
        return normalizePaddlePrice(native);
      } catch (err) {
        if (isPaddleNotFound(err)) return null;
        // Idempotent: Paddle rejects modifying an already-archived price, but
        // the SDK contract makes a double deactivate a no-op — return the
        // (already-archived) current record.
        if (isPaddleAlreadyArchived(err)) {
          const current = await paddle.prices.get(parsed.id);
          return normalizePaddlePrice(current);
        }
        throw mapPaddleError(err, 'prices.deactivate');
      }
    },

    async activate(input) {
      const parsed = validate(Schemas.Prices.PricesActivateInputSchema, input, 'prices.activate');
      try {
        const native = await paddle.prices.update(parsed.id, { status: 'active' });
        return normalizePaddlePrice(native);
      } catch (err) {
        if (isPaddleNotFound(err)) return null;
        throw mapPaddleError(err, 'prices.activate');
      }
    },
  };
}
