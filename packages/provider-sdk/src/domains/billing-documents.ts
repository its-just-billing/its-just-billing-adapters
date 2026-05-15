import type {
  BillingDocumentsGetInput,
  BillingDocumentsGetOutput,
  BillingDocumentsListInput,
  BillingDocumentsListOutput,
} from '../schemas/billing-documents/index.js';

export interface BillingDocuments<TRaw = unknown> {
  list(input?: BillingDocumentsListInput): Promise<BillingDocumentsListOutput<TRaw>>;
  get(input: BillingDocumentsGetInput): Promise<BillingDocumentsGetOutput<TRaw>>;
}
