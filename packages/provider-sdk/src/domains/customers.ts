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

export interface Customers {
  list(input?: CustomersListInput): Promise<CustomersListOutput>;
  get(input: CustomersGetInput): Promise<CustomersGetOutput>;
  create(input: CustomersCreateInput): Promise<CustomersCreateOutput>;
  update(input: CustomersUpdateInput): Promise<CustomersUpdateOutput>;
  archive(input: CustomersArchiveInput): Promise<CustomersArchiveOutput>;
}
