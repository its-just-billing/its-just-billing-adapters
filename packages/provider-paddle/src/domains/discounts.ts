import {
  type DiscountBenefit,
  type DiscountDuration,
  type Discounts,
  type ProviderCapabilities,
  type ProviderDiscount,
  ProviderNotFoundError,
  ProviderNotSupportedError,
  Schemas,
  assertCapabilityValueSupported,
  assertNoReservedKeys,
  validate,
} from '@its-just-billing/provider-sdk';
import type {
  CreateDiscountRequestBody,
  CurrencyCode,
  Discount,
  DiscountType,
  Paddle,
  UpdateDiscountRequestBody,
} from '@paddle/paddle-node-sdk';
import { isPaddleAlreadyArchived, isPaddleNotFound, mapPaddleError } from '../error-mapping.js';
import { PADDLE_RESERVED, preservedReservedKeys } from '../metadata.js';
import { normalizePaddleDiscount } from '../normalize/discount.js';
import { pageFromPaddleCollection } from '../pagination.js';

/**
 * Map the SDK's `DiscountBenefit` onto Paddle's `type` + `amount` (+ currency
 * for flat). Paddle expresses a percentage as `type: 'percentage'` with
 * `amount` carrying the percent ("15"); a fixed discount as `type: 'flat'`
 * with `amount` in minor units and a `currencyCode`. `flat_per_seat` is not
 * emitted on create — the SDK has no per-seat axis.
 */
function benefitToPaddle(
  benefit: DiscountBenefit,
  capabilities: ProviderCapabilities,
  label: string,
): { type: DiscountType; amount: string; currencyCode?: CurrencyCode } {
  if (benefit.kind === 'percent') {
    return { type: 'percentage', amount: String(benefit.percentOff) };
  }
  // Amount benefit: gate the currency against Paddle's declared set so an
  // unsupported currency is a clean ProviderNotSupportedError rather than an
  // opaque Paddle 400 (value-set gating, mirroring the Stripe adapter).
  assertCapabilityValueSupported(
    capabilities.currencies,
    benefit.amountOff.currency,
    'currency',
    label,
  );
  return {
    type: 'flat',
    amount: String(benefit.amountOff.amount),
    // The SDK normalizes currencies to lowercase ISO-4217; Paddle's
    // `CurrencyCode` is the uppercase union. The capability gate above already
    // proved this value is in Paddle's supported set, so the upper-cased cast
    // is sound.
    currencyCode: benefit.amountOff.currency.toUpperCase() as CurrencyCode,
  };
}

/**
 * Map the SDK's `DiscountDuration` onto Paddle's `recur` +
 * `maximumRecurringIntervals` pair:
 *   - `once`            → `recur: false`
 *   - `forever`         → `recur: true`,  no max
 *   - `repeating{months}` → `recur: true`, `maximumRecurringIntervals: months`
 *     (Paddle's interval is the subscribed price's billing cycle; the SDK's
 *     month-denominated count is surfaced as the cycle count — see the
 *     normalizer's matching note).
 */
function durationToPaddle(duration: DiscountDuration): {
  recur: boolean;
  maximumRecurringIntervals?: number | null;
} {
  if (duration.kind === 'once') return { recur: false };
  if (duration.kind === 'forever') return { recur: true, maximumRecurringIntervals: null };
  return { recur: true, maximumRecurringIntervals: duration.months };
}

/**
 * Build the adapter-managed `customData` for a discount. Only `restrictedTo`
 * is round-tripped here: Paddle existence-validates `restrict_to` ids while
 * the SDK contract round-trips arbitrary ids unchanged, so the value is
 * consumer-owned (`discountProductRestrictions`/`discountPriceRestrictions`
 * are `false`) rather than sent to Paddle. The discount `code`, by contrast,
 * is NOT managed — it must actually redeem at Paddle, so it is sent natively
 * and a code outside Paddle's pattern is rejected, not faked.
 *
 * Returns `undefined` when there's nothing to store so a metadata-free
 * discount sends no `customData` at all.
 */
function managedCustomData(
  metadata: Record<string, string> | undefined,
  restrictedTo: ProviderDiscount['restrictedTo'] | undefined,
): Record<string, string> | undefined {
  const out: Record<string, string> = {
    ...(metadata ?? {}),
    ...(restrictedTo ? { [PADDLE_RESERVED.DISCOUNT_RESTRICT]: JSON.stringify(restrictedTo) } : {}),
  };
  return Object.keys(out).length > 0 ? out : undefined;
}

export function createDiscountsDomain(
  paddle: Paddle,
  capabilities: ProviderCapabilities,
): Discounts<Discount> {
  return {
    async list(input) {
      const parsed =
        input !== undefined
          ? validate(Schemas.Discounts.DiscountsListInputSchema, input, 'discounts.list')
          : undefined;
      try {
        // `active: true` maps to Paddle's native `status: ['active']` filter
        // (exact, server-side). `active: false` can't use Paddle's status
        // filter — it permits only active/archived/expired and rejects
        // `used`, so a usage-limited discount (normalized `active: false`)
        // would be silently dropped. Instead fetch unfiltered and select the
        // inactive ones client-side; `nextCursor` still tracks the raw page
        // so forward pagination keeps making progress even if the page
        // shrinks (mirrors the payments refunded-filter handling).
        const collection = paddle.discounts.list({
          ...(parsed?.cursor !== undefined ? { after: parsed.cursor } : {}),
          ...(parsed?.limit !== undefined ? { perPage: parsed.limit } : {}),
          ...(parsed?.active === true ? { status: ['active'] } : {}),
        });
        const page = await pageFromPaddleCollection(collection, normalizePaddleDiscount);
        if (parsed?.active === false) {
          return {
            data: page.data.filter((d) => d.active === false),
            nextCursor: page.nextCursor,
          };
        }
        return page;
      } catch (err) {
        throw mapPaddleError(err, 'discounts.list');
      }
    },

    async get(input) {
      const parsed = validate(Schemas.Discounts.DiscountsGetInputSchema, input, 'discounts.get');
      try {
        const native = await paddle.discounts.get(parsed.id);
        return normalizePaddleDiscount(native);
      } catch (err) {
        if (isPaddleNotFound(err)) return null;
        throw mapPaddleError(err, 'discounts.get');
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
      // The code is sent to Paddle natively (it must redeem there). If the
      // provider constrains code shape, reject an out-of-pattern code rather
      // than faking it — `ProviderNotSupportedError`, surfaced via the
      // `discountCodePattern` capability so callers can pre-flight.
      if (
        callerSuppliedCode &&
        capabilities.discountCodePattern !== undefined &&
        !capabilities.discountCodePattern.test(parsed.code as string)
      ) {
        throw new ProviderNotSupportedError({
          feature: 'discount.code',
          value: parsed.code as string,
          message: `discounts.create: code must match ${capabilities.discountCodePattern} (capabilities.discountCodePattern)`,
        });
      }
      const benefit = benefitToPaddle(parsed.benefit, capabilities, 'discounts.create');
      const duration = durationToPaddle(parsed.duration);
      // Paddle requires a non-empty `description`; the SDK has no such field,
      // so derive a stable one. `restrictTo` is NOT sent (Paddle existence-
      // validates ids; round-tripped via managed `customData`). `code` IS
      // sent natively; `null` when the caller chose none — Paddle has no
      // codeless discount, so it auto-assigns a real, redeemable code which
      // the normalizer surfaces as-is (capability `discountCodeRequired`),
      // never faked back to null.
      const description = callerSuppliedCode ? `Discount ${parsed.code as string}` : 'Discount';
      const customData = managedCustomData(parsed.metadata, parsed.restrictedTo);
      const body: CreateDiscountRequestBody = {
        amount: benefit.amount,
        description,
        type: benefit.type,
        enabledForCheckout: true,
        recur: duration.recur,
        code: callerSuppliedCode ? (parsed.code as string) : null,
        ...(benefit.currencyCode !== undefined ? { currencyCode: benefit.currencyCode } : {}),
        ...(duration.maximumRecurringIntervals !== undefined
          ? { maximumRecurringIntervals: duration.maximumRecurringIntervals }
          : {}),
        ...(parsed.redemptionLimit !== undefined && parsed.redemptionLimit !== null
          ? { usageLimit: parsed.redemptionLimit }
          : {}),
        ...(parsed.expiresAt !== undefined && parsed.expiresAt !== null
          ? { expiresAt: parsed.expiresAt.toISOString() }
          : {}),
        ...(customData !== undefined ? { customData } : {}),
      };
      try {
        const native = await paddle.discounts.create(body);
        return normalizePaddleDiscount(native);
      } catch (err) {
        throw mapPaddleError(err, 'discounts.create');
      }
    },

    async update(input) {
      const parsed = validate(
        Schemas.Discounts.DiscountsUpdateInputSchema,
        input,
        'discounts.update',
      );
      assertNoReservedKeys(parsed.metadata, 'discounts.update');
      // The SDK contract only accepts metadata on update (benefit, duration,
      // code, redemption limit, expiration are immutable post-create). Paddle
      // replaces `customData` wholesale, so a metadata-only update would wipe
      // the adapter-managed code/restrictedTo. When metadata is supplied,
      // pre-fetch and re-attach the reserved keys so they survive the
      // replace; when it is absent, send no `customData` so Paddle keeps the
      // existing object untouched.
      let body: UpdateDiscountRequestBody = {};
      if (parsed.metadata !== undefined) {
        let current: Discount;
        try {
          current = await paddle.discounts.get(parsed.id);
        } catch (err) {
          if (isPaddleNotFound(err)) {
            throw new ProviderNotFoundError({ message: `Discount ${parsed.id} not found` });
          }
          throw mapPaddleError(err, 'discounts.update');
        }
        body = {
          customData: {
            ...parsed.metadata,
            ...preservedReservedKeys(current.customData as Record<string, unknown> | null),
          },
        };
      }
      try {
        const native = await paddle.discounts.update(parsed.id, body);
        return normalizePaddleDiscount(native);
      } catch (err) {
        if (isPaddleNotFound(err)) {
          throw new ProviderNotFoundError({ message: `Discount ${parsed.id} not found` });
        }
        throw mapPaddleError(err, 'discounts.update');
      }
    },

    async deactivate(input) {
      const parsed = validate(
        Schemas.Discounts.DiscountsDeactivateInputSchema,
        input,
        'discounts.deactivate',
      );
      // Soft-delete = Paddle status `archived`. `discounts.archive` is the
      // dedicated endpoint and echoes back the archived discount.
      try {
        const native = await paddle.discounts.archive(parsed.id);
        return normalizePaddleDiscount(native);
      } catch (err) {
        if (isPaddleNotFound(err)) return null;
        // Idempotent: a double deactivate is a no-op per the SDK contract;
        // Paddle rejects re-archiving, so return the current record.
        if (isPaddleAlreadyArchived(err)) {
          const current = await paddle.discounts.get(parsed.id);
          return normalizePaddleDiscount(current);
        }
        throw mapPaddleError(err, 'discounts.deactivate');
      }
    },

    async activate(input) {
      const parsed = validate(
        Schemas.Discounts.DiscountsActivateInputSchema,
        input,
        'discounts.activate',
      );
      // Restore = flip status back to `active` via update (Paddle has no
      // dedicated unarchive endpoint).
      try {
        const native = await paddle.discounts.update(parsed.id, { status: 'active' });
        return normalizePaddleDiscount(native);
      } catch (err) {
        if (isPaddleNotFound(err)) return null;
        throw mapPaddleError(err, 'discounts.activate');
      }
    },
  };
}
