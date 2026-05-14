import { ProviderError, type ProviderErrorOptions } from './base.js';

type UnavailableOpts = Omit<ProviderErrorOptions, 'status' | 'code'> & { status?: number };

export class ProviderUnavailableError extends ProviderError {
  override readonly name = 'ProviderUnavailableError';

  constructor(options: UnavailableOpts) {
    super({
      status: options.status ?? 503,
      code: 'unavailable',
      message: options.message,
      ...(options.cause !== undefined ? { cause: options.cause } : {}),
      ...(options.providerCode !== undefined ? { providerCode: options.providerCode } : {}),
      ...(options.details !== undefined ? { details: options.details } : {}),
    });
  }
}
