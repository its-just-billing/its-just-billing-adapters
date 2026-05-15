import type {
  CustomersArchiveInput,
  CustomersArchiveOutput,
  CustomersCreateInput,
  CustomersCreateOutput,
  CustomersGetInput,
  CustomersGetOutput,
  CustomersListInput,
  CustomersListOutput,
  CustomersUpdateInput,
  CustomersUpdateOutput,
} from '../schemas/customers/index.js';

export interface Customers<TRaw = unknown> {
  list(input?: CustomersListInput): Promise<CustomersListOutput<TRaw>>;
  get(input: CustomersGetInput): Promise<CustomersGetOutput<TRaw>>;
  create(input: CustomersCreateInput): Promise<CustomersCreateOutput<TRaw>>;
  update(input: CustomersUpdateInput): Promise<CustomersUpdateOutput<TRaw>>;
  archive(input: CustomersArchiveInput): Promise<CustomersArchiveOutput<TRaw>>;
}
