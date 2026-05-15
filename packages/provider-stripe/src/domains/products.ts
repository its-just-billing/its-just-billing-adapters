import {
  type Products,
  type ProviderCapabilities,
  ProviderNotFoundError,
  ProviderNotSupportedError,
  Schemas,
  assertNoReservedKeys,
  validate,
} from '@its-just-billing/provider-sdk';
import type Stripe from 'stripe';
import { isStripeNotFound, mapStripeError } from '../error-mapping.js';
import { diffMetadataForReplace } from '../metadata-diff.js';
import { normalizeStripeProduct } from '../normalize/product.js';
import { pageFromStripeList } from '../pagination.js';
import { TAX_CATEGORY_TO_STRIPE } from '../tax-codes.js';

export function createProductsDomain(
  stripe: Stripe,
  capabilities: ProviderCapabilities,
): Products<Stripe.Product> {
  return {
    async list(input) {
      const parsed =
        input !== undefined
          ? validate(Schemas.Products.ProductsListInputSchema, input, 'products.list')
          : undefined;
      try {
        const native = await stripe.products.list({
          ...(parsed?.cursor !== undefined ? { starting_after: parsed.cursor } : {}),
          ...(parsed?.limit !== undefined ? { limit: parsed.limit } : {}),
          ...(parsed?.active !== undefined ? { active: parsed.active } : {}),
        });
        return pageFromStripeList(native, normalizeStripeProduct);
      } catch (err) {
        throw mapStripeError(err, 'products.list');
      }
    },

    async get(input) {
      const parsed = validate(Schemas.Products.ProductsGetInputSchema, input, 'products.get');
      try {
        const native = await stripe.products.retrieve(parsed.id);
        if ('deleted' in native && native.deleted) return null;
        return normalizeStripeProduct(native);
      } catch (err) {
        if (isStripeNotFound(err)) return null;
        throw mapStripeError(err, 'products.get');
      }
    },

    async create(input) {
      const parsed = validate(Schemas.Products.ProductsCreateInputSchema, input, 'products.create');
      assertNoReservedKeys(parsed.metadata, 'products.create');
      if (!capabilities.taxCategories.has(parsed.taxCategory)) {
        throw new ProviderNotSupportedError({
          feature: 'taxCategory',
          value: parsed.taxCategory,
          message: `Stripe does not support taxCategory=${parsed.taxCategory}`,
        });
      }
      // `description` is validated as `string().min(1).nullable().optional()`
      // — empty string is rejected at the SDK boundary, so by the time we get
      // here it's a non-empty string, null, or undefined. Pass through
      // when present; otherwise omit.
      const params: Stripe.ProductCreateParams = {
        name: parsed.name,
        tax_code: TAX_CATEGORY_TO_STRIPE[parsed.taxCategory],
        ...(parsed.description !== undefined && parsed.description !== null
          ? { description: parsed.description }
          : {}),
        ...(parsed.metadata !== undefined ? { metadata: { ...parsed.metadata } } : {}),
      };
      try {
        const native = await stripe.products.create(params);
        return normalizeStripeProduct(native);
      } catch (err) {
        throw mapStripeError(err, 'products.create');
      }
    },

    async update(input) {
      const parsed = validate(Schemas.Products.ProductsUpdateInputSchema, input, 'products.update');
      assertNoReservedKeys(parsed.metadata, 'products.update');
      // See customers.update for the Stripe merge-semantics rationale.
      let metadataParam: Stripe.MetadataParam | undefined;
      if (parsed.metadata !== undefined) {
        try {
          const current = await stripe.products.retrieve(parsed.id);
          if ('deleted' in current && current.deleted) {
            throw new ProviderNotFoundError({ message: `Product ${parsed.id} not found` });
          }
          metadataParam = diffMetadataForReplace(parsed.metadata, current.metadata);
        } catch (err) {
          if (isStripeNotFound(err)) {
            throw new ProviderNotFoundError({ message: `Product ${parsed.id} not found` });
          }
          throw mapStripeError(err, 'products.update');
        }
      }
      // The SDK contract makes `description` non-clearable on update — the
      // schema accepts only a non-empty string (empty string and null both
      // rejected at validation). Pass through when present.
      const params: Stripe.ProductUpdateParams = {
        ...(parsed.name !== undefined ? { name: parsed.name } : {}),
        ...(parsed.description !== undefined ? { description: parsed.description } : {}),
        ...(metadataParam !== undefined ? { metadata: metadataParam } : {}),
      };
      try {
        const native = await stripe.products.update(parsed.id, params);
        return normalizeStripeProduct(native);
      } catch (err) {
        if (isStripeNotFound(err)) {
          throw new ProviderNotFoundError({ message: `Product ${parsed.id} not found` });
        }
        throw mapStripeError(err, 'products.update');
      }
    },

    async deactivate(input) {
      const parsed = validate(
        Schemas.Products.ProductsDeactivateInputSchema,
        input,
        'products.deactivate',
      );
      try {
        const native = await stripe.products.update(parsed.id, { active: false });
        return normalizeStripeProduct(native);
      } catch (err) {
        if (isStripeNotFound(err)) return null;
        throw mapStripeError(err, 'products.deactivate');
      }
    },

    async activate(input) {
      const parsed = validate(
        Schemas.Products.ProductsActivateInputSchema,
        input,
        'products.activate',
      );
      try {
        const native = await stripe.products.update(parsed.id, { active: true });
        return normalizeStripeProduct(native);
      } catch (err) {
        if (isStripeNotFound(err)) return null;
        throw mapStripeError(err, 'products.activate');
      }
    },
  };
}
