import type {
  PaymentMethodsListInput,
  PaymentMethodsListOutput,
} from '../schemas/payment-methods/index.js';

export interface PaymentMethods<TRaw = unknown> {
  list(input: PaymentMethodsListInput): Promise<PaymentMethodsListOutput<TRaw>>;
}
