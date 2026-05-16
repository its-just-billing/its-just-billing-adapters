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
  normalizeStripePromotionCode,
} from '../normalize/discount.js';
import { pageFromStripeList } from '../pagination.js';

// Stripe omits the embedded coupon's `applies_to` from a PromotionCode
// response unless explicitly expanded. It's a same-request expand (zero extra
// round-trips), required so product-scoped `restrictedTo` round-trips
// natively. `data.` prefix form is for list responses.
//
// NOTE (do not "fix" by removing): `coupon.applies_to` LOOKS like a plain
// sub-object, not a top-level expandable id reference, so static review keeps
// flagging this as an invalid expand. It is not. Verified against the live
// Stripe API on all four call forms (create / retrieve / list / update):
// without the expand the embedded coupon returns `applies_to: undefined`;
// with it the request is accepted and `applies_to.products` is populated.
// The full live conformance suite (903/903) exercises every one of these
// calls. Stripe's expand mechanism applies to nested sub-objects of embedded
// resources, not only to id references.
const COUPON_APPLIES_TO_EXPAND = ['coupon.applies_to'];
const COUPON_APPLIES_TO_EXPAND_LIST = ['data.coupon.applies_to'];

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
          expand: COUPON_APPLIES_TO_EXPAND_LIST,
        });
        return pageFromStripeList(native, normalizeStripePromotionCode);
      } catch (err) {
        throw mapStripeError(err, 'discounts.list');
      }
    },

    async get(input) {
      const parsed = validate(Schemas.Discounts.DiscountsGetInputSchema, input, 'discounts.get');
      try {
        const native = await stripe.promotionCodes.retrieve(parsed.id, {
          expand: COUPON_APPLIES_TO_EXPAND,
        });
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
      // restrictedTo splits by what Stripe enforces natively:
      //   - Product scope → Stripe's native `coupon.applies_to.products`
      //     (one field, zero extra round-trips). Stripe rejects product ids
      //     that don't exist on the account — that's honest enforcement, and
      //     `capabilities.features.discountProductRestrictions` is `true`.
      //   - Price scope → no native mechanism. Round-tripped via reserved
      //     metadata below; not enforced by the adapter
      //     (`discountPriceRestrictions` is `false`).
      const couponParams: Stripe.CouponCreateParams = {
        duration: parsed.duration.kind,
        ...(parsed.duration.kind === 'repeating'
          ? { duration_in_months: parsed.duration.months }
          : {}),
        ...(parsed.restrictedTo?.productIds !== undefined &&
        parsed.restrictedTo.productIds.length > 0
          ? { applies_to: { products: parsed.restrictedTo.productIds } }
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
      // auto-generated string would round-trip incorrectly. Product
      // restrictions live on the native coupon (above); only the
      // price-scoped list is stashed in managed metadata for round-trip.
      const callerMetadata: Record<string, string> = { ...(parsed.metadata ?? {}) };
      if (!callerSuppliedCode) callerMetadata[ANONYMOUS_CODE_MARKER_KEY] = '1';
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
        expand: COUPON_APPLIES_TO_EXPAND,
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
        expand: COUPON_APPLIES_TO_EXPAND,
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
        const native = await stripe.promotionCodes.update(parsed.id, {
          active: false,
          expand: COUPON_APPLIES_TO_EXPAND,
        });
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
        const native = await stripe.promotionCodes.update(parsed.id, {
          active: true,
          expand: COUPON_APPLIES_TO_EXPAND,
        });
        return normalizeStripePromotionCode(native);
      } catch (err) {
        if (isStripeNotFound(err)) return null;
        throw mapStripeError(err, 'discounts.activate');
      }
    },
  };
}
