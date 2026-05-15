import type {
  PaymentsGetInput,
  PaymentsGetOutput,
  PaymentsListInput,
  PaymentsListOutput,
} from '../schemas/payments/index.js';

export interface Payments<TRaw = unknown> {
  list(input?: PaymentsListInput): Promise<PaymentsListOutput<TRaw>>;
  get(input: PaymentsGetInput): Promise<PaymentsGetOutput<TRaw>>;
}
