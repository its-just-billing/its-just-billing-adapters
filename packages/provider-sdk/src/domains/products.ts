import type {
  ProductsActivateInput,
  ProductsActivateOutput,
  ProductsCreateInput,
  ProductsCreateOutput,
  ProductsDeactivateInput,
  ProductsDeactivateOutput,
  ProductsGetInput,
  ProductsGetOutput,
  ProductsListInput,
  ProductsListOutput,
  ProductsUpdateInput,
  ProductsUpdateOutput,
} from '../schemas/products/index.js';

export interface Products<TRaw = unknown> {
  list(input?: ProductsListInput): Promise<ProductsListOutput<TRaw>>;
  get(input: ProductsGetInput): Promise<ProductsGetOutput<TRaw>>;
  create(input: ProductsCreateInput): Promise<ProductsCreateOutput<TRaw>>;
  update(input: ProductsUpdateInput): Promise<ProductsUpdateOutput<TRaw>>;
  /** Soft-delete: sets `active: false`. Null when the id does not exist. */
  deactivate(input: ProductsDeactivateInput): Promise<ProductsDeactivateOutput<TRaw>>;
  /** Restore a soft-deleted product. Null when the id does not exist. */
  activate(input: ProductsActivateInput): Promise<ProductsActivateOutput<TRaw>>;
}
