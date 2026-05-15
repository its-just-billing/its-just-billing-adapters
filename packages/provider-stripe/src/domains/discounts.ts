import {
  type Discounts,
  ProviderConflictError,
  ProviderNotFoundError,
  Schemas,
  assertNoReservedKeys,
  validate,
} from '@its-just-billing/provider-sdk';
import type Stripe from 'stripe';
import { isStripeNotFound, mapStripeError } from '../error-mapping.js';
import { diffMetadataForReplace } from '../metadata-diff.js';
import {
  ANONYMOUS_CODE_MARKER_KEY,
  RESTRICTED_PRICE_IDS_KEY,
  RESTRICTED_PRODUCT_IDS_KEY,
  normalizeStripePromotionCode,
} from '../normalize/discount.js';
import { pageFromStripeList } from '../pagination.js';

export function createDiscountsDomain(stripe: Stripe): Discounts<Stripe.PromotionCode> {
  return {
    async list(input) {
      const parsed =
        input !== undefined
          ? validate(Schemas.Discounts.DiscountsListInputSchema, input, 'discounts.list')
          : undefined;
      try {
        const native = await stripe.promotionCodes.list({
          ...(parsed?.cursor !== undefined ? { starting_after: parsed.cursor } : {}),
          ...(parsed?.limit !== undefined ? { limit: parsed.limit } : {}),
          ...(parsed?.active !== undefined ? { active: parsed.active } : {}),
        });
        return pageFromStripeList(native, normalizeStripePromotionCode);
      } catch (err) {
        throw mapStripeError(err, 'discounts.list');
      }
    },

    async get(input) {
      const parsed = validate(Schemas.Discounts.DiscountsGetInputSchema, input, 'discounts.get');
      try {
        const native = await stripe.promotionCodes.retrieve(parsed.id);
        return normalizeStripePromotionCode(native);
      } catch (err) {
        if (isStripeNotFound(err)) return null;
        throw mapStripeError(err, 'discounts.get');
      }
    },

    async create(input) {
      const parsed = validate(
        Schemas.Discounts.DiscountsCreateInputSchema,
        input,
        'discounts.create',
      );
      assertNoReservedKeys(parsed.metadata, 'discounts.create');
      const callerSuppliedCode = parsed.code !== undefined && parsed.code !== null;
      // Pre-check for an existing promotion code with the same string. Stripe
      // rejects duplicates with a 400 + an opaque message; surfacing as
      // ProviderConflictError is the contract, and a pre-check is more
      // reliable than matching the error string. Cheap (single list call,
      // limit=1) and we skip it when the caller didn't pick a code (Stripe
      // auto-generates a unique one).
      if (callerSuppliedCode) {
        try {
          const existing = await stripe.promotionCodes.list({
            code: parsed.code as string,
            limit: 1,
          });
          if (existing.data.length > 0) {
            throw new ProviderConflictError({
              message: `discounts.create: promotion code "${parsed.code}" already exists`,
            });
          }
        } catch (err) {
          if (err instanceof ProviderConflictError) throw err;
          throw mapStripeError(err, 'discounts.create');
        }
      }
      // restrictedTo: We do NOT pass it to Stripe's native `applies_to`.
      //   - Stripe rejects unknown product ids (test mode often references
      //     products that don't exist).
      //   - Stripe has no native price-level restriction.
      // Instead we stash both lists in adapter-managed reserved metadata so
      // the value round-trips through the API. Actual restriction enforcement
      // is not in effect on Stripe for SDK-created discounts — callers needing
      // real enforcement should drop to `provider.raw` and configure
      // `applies_to.products` directly.
      const couponParams: Stripe.CouponCreateParams = {
        duration: parsed.duration.kind,
        ...(parsed.duration.kind === 'repeating'
          ? { duration_in_months: parsed.duration.months }
          : {}),
        ...(parsed.benefit.kind === 'percent'
          ? { percent_off: parsed.benefit.percentOff }
          : {
              amount_off: parsed.benefit.amountOff.amount,
              currency: parsed.benefit.amountOff.currency,
            }),
        // NB: do NOT set Coupon.max_redemptions. The SDK contract surfaces
        // redemptionLimit on the discount (which we expose as the
        // PromotionCode); setting it on the underlying Coupon would also
        // count redemptions from any other promotion codes attached to the
        // same coupon (we don't create extras, but the field's semantics
        // are different per Stripe).
      };
      let coupon: Stripe.Coupon;
      try {
        coupon = await stripe.coupons.create(couponParams);
      } catch (err) {
        throw mapStripeError(err, 'discounts.create');
      }
      // Mark anonymous (auto-generated) codes so the normalizer can surface
      // `code: null` to match the SDK contract. Without this, Stripe's
      // auto-generated string would round-trip incorrectly. Also stash
      // restrictedTo if the caller supplied it — see the comment block above
      // couponParams for why we don't use Stripe's native applies_to.
      const callerMetadata: Record<string, string> = { ...(parsed.metadata ?? {}) };
      if (!callerSuppliedCode) callerMetadata[ANONYMOUS_CODE_MARKER_KEY] = '1';
      if (parsed.restrictedTo?.productIds !== undefined) {
        callerMetadata[RESTRICTED_PRODUCT_IDS_KEY] = JSON.stringify(parsed.restrictedTo.productIds);
      }
      if (parsed.restrictedTo?.priceIds !== undefined) {
        callerMetadata[RESTRICTED_PRICE_IDS_KEY] = JSON.stringify(parsed.restrictedTo.priceIds);
      }
      const pcParams: Stripe.PromotionCodeCreateParams = {
        coupon: coupon.id,
        ...(callerSuppliedCode ? { code: parsed.code as string } : {}),
        ...(parsed.expiresAt !== undefined && parsed.expiresAt !== null
          ? { expires_at: Math.floor(parsed.expiresAt.getTime() / 1000) }
          : {}),
        ...(parsed.redemptionLimit !== undefined && parsed.redemptionLimit !== null
          ? { max_redemptions: parsed.redemptionLimit }
          : {}),
        metadata: callerMetadata,
      };
      try {
        const pc = await stripe.promotionCodes.create(pcParams);
        return normalizeStripePromotionCode(pc);
      } catch (err) {
        // If promotion code creation fails, the coupon is orphaned. Best-effort
        // cleanup; swallow cleanup failure since the original error is what
        // matters.
        try {
          await stripe.coupons.del(coupon.id);
        } catch {}
        // Stripe rejects duplicate promotion codes with a 400 and a specific
        // message — translate to ProviderConflictError so callers can branch
        // on the normalized error hierarchy.
        if (err instanceof Error && /promotion code that is already active/i.test(err.message)) {
          throw new ProviderConflictError({
            message: `discounts.create: promotion code already exists (${parsed.code ?? ''})`,
            cause: err,
          });
        }
        throw mapStripeError(err, 'discounts.create');
      }
    },

    async update(input) {
      const parsed = validate(
        Schemas.Discounts.DiscountsUpdateInputSchema,
        input,
        'discounts.update',
      );
      assertNoReservedKeys(parsed.metadata, 'discounts.update');
      // The SDK contract no longer accepts `expiresAt` on update — expiration
      // is immutable post-create on both Stripe and Paddle. Zod strips any
      // caller-provided value at the boundary, so this method only deals with
      // metadata.
      let metadataParam: Stripe.MetadataParam | undefined;
      if (parsed.metadata !== undefined) {
        try {
          const current = await stripe.promotionCodes.retrieve(parsed.id);
          metadataParam = diffMetadataForReplace(parsed.metadata, current.metadata);
        } catch (err) {
          if (isStripeNotFound(err)) {
            throw new ProviderNotFoundError({ message: `Discount ${parsed.id} not found` });
          }
          throw mapStripeError(err, 'discounts.update');
        }
      }
      const params: Stripe.PromotionCodeUpdateParams = {
        ...(metadataParam !== undefined ? { metadata: metadataParam } : {}),
      };
      try {
        const native = await stripe.promotionCodes.update(parsed.id, params);
        return normalizeStripePromotionCode(native);
      } catch (err) {
        if (isStripeNotFound(err)) {
          throw new ProviderNotFoundError({ message: `Discount ${parsed.id} not found` });
        }
        throw mapStripeError(err, 'discounts.update');
      }
    },

    async deactivate(input) {
      const parsed = validate(
        Schemas.Discounts.DiscountsDeactivateInputSchema,
        input,
        'discounts.deactivate',
      );
      try {
        const native = await stripe.promotionCodes.update(parsed.id, { active: false });
        return normalizeStripePromotionCode(native);
      } catch (err) {
        if (isStripeNotFound(err)) return null;
        throw mapStripeError(err, 'discounts.deactivate');
      }
    },

    async activate(input) {
      const parsed = validate(
        Schemas.Discounts.DiscountsActivateInputSchema,
        input,
        'discounts.activate',
      );
      try {
        const native = await stripe.promotionCodes.update(parsed.id, { active: true });
        return normalizeStripePromotionCode(native);
      } catch (err) {
        if (isStripeNotFound(err)) return null;
        throw mapStripeError(err, 'discounts.activate');
      }
    },
  };
}
