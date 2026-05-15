import { z } from '../zod.js';
import { AppliedDiscountSchema } from './applied-discount.js';
import { MetadataSchema } from './metadata.js';
import { MoneySchema } from './money.js';

export const PaymentStatusSchema = z.enum([
  'pending',
  'succeeded',
  'failed',
  'refunded',
  'partially_refunded',
]);
export type PaymentStatus = z.infer<typeof PaymentStatusSchema>;

export const ProviderPaymentSchema = z
  .object({
    id: z.string().min(1),
    customerId: z.string().nullable(),
    status: PaymentStatusSchema,
    amount: MoneySchema,
    // Pre-discount, pre-tax subtotal in the same currency as `amount`. Optional
    // because not every provider exposes it on a one-time charge (Stripe Charge
    // has no subtotal field; invoice-backed charges do via `Invoice.subtotal`).
    // When absent, callers can fall back to `amount + sum(appliedDiscounts[].
    // amountDiscounted)` as an approximation (ignoring tax).
    subtotal: MoneySchema.optional(),
    amountRefunded: MoneySchema.nullable(),
    // Zero or more discounts that were applied to this payment, in the order
    // the provider reports them. Empty array means none applied. Adapters
    // guarantee each entry's currency matches the payment's `amount`.
    appliedDiscounts: z.array(AppliedDiscountSchema),
    priceId: z.string().nullable(),
    productId: z.string().nullable(),
    checkoutSessionId: z.string().nullable(),
    metadata: MetadataSchema,
    createdAt: z.date(),
    raw: z.unknown().optional(),
  })
  .openapi('ProviderPayment', {
    description:
      'A normalized money-movement record. One-time purchases, subscription renewal charges, and any other payment events land here.',
  });

export type ProviderPayment<TRaw = unknown> = Omit<z.infer<typeof ProviderPaymentSchema>, 'raw'> & {
  raw?: TRaw;
};
