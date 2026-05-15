import { z } from '../zod.js';
import { MoneySchema } from './money.js';

/**
 * One discount that was applied to a checkout session or a payment. Carriers
 * (ProviderPayment, ProviderCheckoutSession) expose an array of these to
 * describe what discounts actually landed on the money flow; an empty array
 * means no discount applied.
 *
 * - `discountId` is re-fetchable via `provider.discounts.get({ id })`.
 * - `code` is the public-facing redemption code if any; `null` when the
 *   discount has no code (e.g. an auto-applied discount).
 * - `amountDiscounted` is the discount's contribution in the carrier's
 *   currency. Adapters guarantee currency parity with the carrier's `amount`.
 */
export const AppliedDiscountSchema = z
  .object({
    discountId: z.string().min(1),
    code: z.string().min(1).nullable(),
    amountDiscounted: MoneySchema,
  })
  .strict()
  .openapi('AppliedDiscount', {
    description:
      'A single discount applied to a payment or checkout session. Use `discountId` to refetch the full ProviderDiscount via `discounts.get`.',
  });

export type AppliedDiscount = z.infer<typeof AppliedDiscountSchema>;
