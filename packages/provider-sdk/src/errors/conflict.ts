import { ProviderError, type ProviderErrorOptions } from './base.js';

export class ProviderConflictError extends ProviderError {
  override readonly name = 'ProviderConflictError';

  constructor(options: Omit<ProviderErrorOptions, 'status' | 'code'>) {
    super({
      status: 409,
      code: 'conflict',
      message: options.message,
      ...(options.cause !== undefined ? { cause: options.cause } : {}),
      ...(options.providerCode !== undefined ? { providerCode: options.providerCode } : {}),
      ...(options.details !== undefined ? { details: options.details } : {}),
    });
  }
}
