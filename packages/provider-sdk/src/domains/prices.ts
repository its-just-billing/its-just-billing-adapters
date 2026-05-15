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

export interface Prices<TRaw = unknown> {
  list(input?: PricesListInput): Promise<PricesListOutput<TRaw>>;
  get(input: PricesGetInput): Promise<PricesGetOutput<TRaw>>;
  create(input: PricesCreateInput): Promise<PricesCreateOutput<TRaw>>;
  update(input: PricesUpdateInput): Promise<PricesUpdateOutput<TRaw>>;
  /** Soft-delete: sets `active: false`. Null when the id does not exist. */
  deactivate(input: PricesDeactivateInput): Promise<PricesDeactivateOutput<TRaw>>;
  /** Restore a soft-deleted price. Null when the id does not exist. */
  activate(input: PricesActivateInput): Promise<PricesActivateOutput<TRaw>>;
}
