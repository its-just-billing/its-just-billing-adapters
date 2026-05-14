import type {
  PaymentMethodsListInput,
  PaymentMethodsListOutput,
} from '../schemas/payment-methods/index.js';

export interface PaymentMethods {
  list(input: PaymentMethodsListInput): Promise<PaymentMethodsListOutput>;
}
