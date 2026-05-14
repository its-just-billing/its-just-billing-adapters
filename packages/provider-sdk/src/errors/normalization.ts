import { ProviderError, type ProviderErrorOptions } from './base.js';

export class ProviderNormalizationError extends ProviderError {
  override readonly name = 'ProviderNormalizationError';

  constructor(options: Omit<ProviderErrorOptions, 'status' | 'code'>) {
    super({
      status: 502,
      code: 'normalization',
      message: options.message,
      ...(options.cause !== undefined ? { cause: options.cause } : {}),
      ...(options.providerCode !== undefined ? { providerCode: options.providerCode } : {}),
      ...(options.details !== undefined ? { details: options.details } : {}),
    });
  }
}
