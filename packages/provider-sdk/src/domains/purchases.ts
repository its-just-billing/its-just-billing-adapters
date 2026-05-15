import type {
  PurchasesGetInput,
  PurchasesGetOutput,
  PurchasesListInput,
  PurchasesListOutput,
} from '../schemas/purchases/index.js';

export interface Purchases<TRaw = unknown> {
  list(input?: PurchasesListInput): Promise<PurchasesListOutput<TRaw>>;
  get(input: PurchasesGetInput): Promise<PurchasesGetOutput<TRaw>>;
}
