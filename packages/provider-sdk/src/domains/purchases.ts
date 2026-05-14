import type {
  PurchasesGetInput,
  PurchasesGetOutput,
  PurchasesListInput,
  PurchasesListOutput,
} from '../schemas/purchases/index.js';

export interface Purchases {
  list(input?: PurchasesListInput): Promise<PurchasesListOutput>;
  get(input: PurchasesGetInput): Promise<PurchasesGetOutput>;
}
