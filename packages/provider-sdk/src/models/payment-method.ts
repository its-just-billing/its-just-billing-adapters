import { z } from '../zod.js';

export const PaymentMethodKindSchema = z.enum(['card', 'bank_account', 'paypal', 'other']);
export type PaymentMethodKind = z.infer<typeof PaymentMethodKindSchema>;

export const ProviderPaymentMethodSchema = z
  .object({
    id: z.string().min(1),
    customerId: z.string().min(1),
    kind: PaymentMethodKindSchema,
    brand: z.string().nullable(),
    last4: z.string().nullable(),
    expMonth: z.number().int().min(1).max(12).nullable(),
    expYear: z.number().int().nullable(),
    isDefault: z.boolean(),
    raw: z.unknown().optional(),
  })
  .openapi('ProviderPaymentMethod', {
    description: 'Non-sensitive summary of a customer payment method.',
  });

export type ProviderPaymentMethod<TRaw = unknown> = Omit<
  z.infer<typeof ProviderPaymentMethodSchema>,
  'raw'
> & { raw?: TRaw };
