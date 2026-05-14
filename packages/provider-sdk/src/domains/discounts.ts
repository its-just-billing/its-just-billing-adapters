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

export interface Discounts {
  list(input?: DiscountsListInput): Promise<DiscountsListOutput>;
  get(input: DiscountsGetInput): Promise<DiscountsGetOutput>;
  create(input: DiscountsCreateInput): Promise<DiscountsCreateOutput>;
  update(input: DiscountsUpdateInput): Promise<DiscountsUpdateOutput>;
  /** Soft-delete: sets `active: false`. Null when the id does not exist. */
  deactivate(input: DiscountsDeactivateInput): Promise<DiscountsDeactivateOutput>;
  /** Restore a soft-deleted discount. Null when the id does not exist. */
  activate(input: DiscountsActivateInput): Promise<DiscountsActivateOutput>;
}
