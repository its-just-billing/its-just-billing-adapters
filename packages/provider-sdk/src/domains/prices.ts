import type {
  PricesActivateInput,
  PricesActivateOutput,
  PricesCreateInput,
  PricesCreateOutput,
  PricesDeactivateInput,
  PricesDeactivateOutput,
  PricesGetInput,
  PricesGetOutput,
  PricesListInput,
  PricesListOutput,
  PricesUpdateInput,
  PricesUpdateOutput,
} from '../schemas/prices/index.js';

export interface Prices {
  list(input?: PricesListInput): Promise<PricesListOutput>;
  get(input: PricesGetInput): Promise<PricesGetOutput>;
  create(input: PricesCreateInput): Promise<PricesCreateOutput>;
  update(input: PricesUpdateInput): Promise<PricesUpdateOutput>;
  /** Soft-delete: sets `active: false`. Null when the id does not exist. */
  deactivate(input: PricesDeactivateInput): Promise<PricesDeactivateOutput>;
  /** Restore a soft-deleted price. Null when the id does not exist. */
  activate(input: PricesActivateInput): Promise<PricesActivateOutput>;
}
