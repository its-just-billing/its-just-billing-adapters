import {
  type Prices,
  type ProviderCapabilities,
  ProviderNotFoundError,
  ProviderNotSupportedError,
  RESERVED_METADATA_KEYS,
  Schemas,
  assertNoReservedKeys,
  defaultQuantityFor,
  encodeQuantityToMetadata,
  validate,
} from '@its-just-billing/provider-sdk';
import type Stripe from 'stripe';
import { isStripeNotFound, mapStripeError } from '../error-mapping.js';
import { diffMetadataForReplace } from '../metadata-diff.js';
import { normalizeStripePrice } from '../normalize/price.js';
import { pageFromStripeList } from '../pagination.js';

export function createPricesDomain(
  stripe: Stripe,
  capabilities: ProviderCapabilities,
): Prices<Stripe.Price> {
  return {
    async list(input) {
      const parsed =
        input !== undefined
          ? validate(Schemas.Prices.PricesListInputSchema, input, 'prices.list')
          : undefined;
      try {
        const native = await stripe.prices.list({
          ...(parsed?.cursor !== undefined ? { starting_after: parsed.cursor } : {}),
          ...(parsed?.limit !== undefined ? { limit: parsed.limit } : {}),
          ...(parsed?.productId !== undefined ? { product: parsed.productId } : {}),
          ...(parsed?.active !== undefined ? { active: parsed.active } : {}),
        });
        return pageFromStripeList(native, normalizeStripePrice);
      } catch (err) {
        throw mapStripeError(err, 'prices.list');
      }
    },

    async get(input) {
      const parsed = validate(Schemas.Prices.PricesGetInputSchema, input, 'prices.get');
      try {
        const native = await stripe.prices.retrieve(parsed.id);
        return normalizeStripePrice(native);
      } catch (err) {
        if (isStripeNotFound(err)) return null;
        throw mapStripeError(err, 'prices.get');
      }
    },

    async create(input) {
      const parsed = validate(Schemas.Prices.PricesCreateInputSchema, input, 'prices.create');
      assertNoReservedKeys(parsed.metadata, 'prices.create');
      if (!capabilities.currencies.has(parsed.currency)) {
        throw new ProviderNotSupportedError({
          feature: 'currency',
          value: parsed.currency,
          message: `Stripe does not support currency=${parsed.currency}`,
        });
      }
      const quantity = parsed.quantity ?? defaultQuantityFor(parsed.kind);
      const metadata: Stripe.MetadataParam = {
        ...(parsed.metadata ?? {}),
        ...encodeQuantityToMetadata(quantity),
      };
      const params: Stripe.PriceCreateParams = {
        product: parsed.productId,
        currency: parsed.currency,
        unit_amount: parsed.unitAmount,
        metadata,
        ...(parsed.kind === 'recurring'
          ? {
              recurring: {
                interval: parsed.interval,
                interval_count: parsed.intervalCount ?? 1,
              },
            }
          : {}),
      };
      try {
        const native = await stripe.prices.create(params);
        return normalizeStripePrice(native);
      } catch (err) {
        throw mapStripeError(err, 'prices.create');
      }
    },

    async update(input) {
      const parsed = validate(Schemas.Prices.PricesUpdateInputSchema, input, 'prices.update');
      assertNoReservedKeys(parsed.metadata, 'prices.update');
      // Both metadata and quantity require a pre-fetch:
      //   - metadata: Stripe writes merge, so caller-driven replacement must
      //     emit empty-string deletes for keys no longer present.
      //   - quantity: lives in reserved `__provider_quantity_*` keys; if the
      //     caller is also rewriting metadata we must preserve those.
      let current: Stripe.Price | undefined;
      if (parsed.metadata !== undefined || parsed.quantity !== undefined) {
        try {
          current = await stripe.prices.retrieve(parsed.id);
        } catch (err) {
          if (isStripeNotFound(err)) {
            throw new ProviderNotFoundError({ message: `Price ${parsed.id} not found` });
          }
          throw mapStripeError(err, 'prices.update');
        }
      }
      let metadataParam: Stripe.MetadataParam | undefined;
      if (parsed.metadata !== undefined) {
        metadataParam = diffMetadataForReplace(parsed.metadata, current?.metadata);
      }
      if (parsed.quantity !== undefined) {
        if (metadataParam === undefined) metadataParam = {};
        Object.assign(metadataParam, encodeQuantityToMetadata(parsed.quantity));
        // `encodeQuantityToMetadata` only emits QUANTITY_MAX when the new
        // quantity has a max. Stripe metadata writes merge, so a previously
        // set `__provider_quantity_max` would persist if we don't explicitly
        // delete it — `decodeQuantityFromMetadata` would then keep enforcing
        // the stale upper bound on the next read. Emit the empty-string
        // delete sentinel when the new quantity is unbounded.
        if (parsed.quantity.max === undefined) {
          metadataParam[RESERVED_METADATA_KEYS.QUANTITY_MAX] = '';
        }
      }
      const params: Stripe.PriceUpdateParams = {
        ...(metadataParam !== undefined ? { metadata: metadataParam } : {}),
      };
      try {
        const native = await stripe.prices.update(parsed.id, params);
        return normalizeStripePrice(native);
      } catch (err) {
        if (isStripeNotFound(err)) {
          throw new ProviderNotFoundError({ message: `Price ${parsed.id} not found` });
        }
        throw mapStripeError(err, 'prices.update');
      }
    },

    async deactivate(input) {
      const parsed = validate(
        Schemas.Prices.PricesDeactivateInputSchema,
        input,
        'prices.deactivate',
      );
      try {
        const native = await stripe.prices.update(parsed.id, { active: false });
        return normalizeStripePrice(native);
      } catch (err) {
        if (isStripeNotFound(err)) return null;
        throw mapStripeError(err, 'prices.deactivate');
      }
    },

    async activate(input) {
      const parsed = validate(Schemas.Prices.PricesActivateInputSchema, input, 'prices.activate');
      try {
        const native = await stripe.prices.update(parsed.id, { active: true });
        return normalizeStripePrice(native);
      } catch (err) {
        if (isStripeNotFound(err)) return null;
        throw mapStripeError(err, 'prices.activate');
      }
    },
  };
}
