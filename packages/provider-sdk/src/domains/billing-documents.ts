import type {
  BillingDocumentsGetInput,
  BillingDocumentsGetOutput,
  BillingDocumentsListInput,
  BillingDocumentsListOutput,
} from '../schemas/billing-documents/index.js';

export interface BillingDocuments {
  list(input?: BillingDocumentsListInput): Promise<BillingDocumentsListOutput>;
  get(input: BillingDocumentsGetInput): Promise<BillingDocumentsGetOutput>;
}
