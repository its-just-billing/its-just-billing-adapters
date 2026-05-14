import { ProviderError, type ProviderErrorOptions } from './base.js';

export class ProviderConstraintError extends ProviderError {
  override readonly name = 'ProviderConstraintError';

  constructor(options: Omit<ProviderErrorOptions, 'status' | 'code'>) {
    super({
      status: 422,
      code: 'constraint',
      message: options.message,
      ...(options.cause !== undefined ? { cause: options.cause } : {}),
      ...(options.providerCode !== undefined ? { providerCode: options.providerCode } : {}),
      ...(options.details !== undefined ? { details: options.details } : {}),
    });
  }
}
