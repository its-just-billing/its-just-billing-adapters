import { ProviderError, type ProviderErrorOptions } from './base.js';

export class ProviderNotFoundError extends ProviderError {
  override readonly name = 'ProviderNotFoundError';

  constructor(options: Omit<ProviderErrorOptions, 'status' | 'code'>) {
    super({
      status: 404,
      code: 'not_found',
      message: options.message,
      ...(options.cause !== undefined ? { cause: options.cause } : {}),
      ...(options.providerCode !== undefined ? { providerCode: options.providerCode } : {}),
      ...(options.details !== undefined ? { details: options.details } : {}),
    });
  }
}
