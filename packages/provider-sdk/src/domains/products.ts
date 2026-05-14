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

export interface Products {
  list(input?: ProductsListInput): Promise<ProductsListOutput>;
  get(input: ProductsGetInput): Promise<ProductsGetOutput>;
  create(input: ProductsCreateInput): Promise<ProductsCreateOutput>;
  update(input: ProductsUpdateInput): Promise<ProductsUpdateOutput>;
  /** Soft-delete: sets `active: false`. Null when the id does not exist. */
  deactivate(input: ProductsDeactivateInput): Promise<ProductsDeactivateOutput>;
  /** Restore a soft-deleted product. Null when the id does not exist. */
  activate(input: ProductsActivateInput): Promise<ProductsActivateOutput>;
}
