import type {
  DiscountsActivateInput,
  DiscountsActivateOutput,
  DiscountsCreateInput,
  DiscountsCreateOutput,
  DiscountsDeactivateInput,
  DiscountsDeactivateOutput,
  DiscountsGetInput,
  DiscountsGetOutput,
  DiscountsListInput,
  DiscountsListOutput,
  DiscountsUpdateInput,
  DiscountsUpdateOutput,
} from '../schemas/discounts/index.js';

export interface Discounts<TRaw = unknown> {
  list(input?: DiscountsListInput): Promise<DiscountsListOutput<TRaw>>;
  get(input: DiscountsGetInput): Promise<DiscountsGetOutput<TRaw>>;
  create(input: DiscountsCreateInput): Promise<DiscountsCreateOutput<TRaw>>;
  update(input: DiscountsUpdateInput): Promise<DiscountsUpdateOutput<TRaw>>;
  /** Soft-delete: sets `active: false`. Null when the id does not exist. */
  deactivate(input: DiscountsDeactivateInput): Promise<DiscountsDeactivateOutput<TRaw>>;
  /** Restore a soft-deleted discount. Null when the id does not exist. */
  activate(input: DiscountsActivateInput): Promise<DiscountsActivateOutput<TRaw>>;
}
