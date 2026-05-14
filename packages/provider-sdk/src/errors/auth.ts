import { ProviderError, type ProviderErrorOptions } from './base.js';

type AuthOpts = Omit<ProviderErrorOptions, 'status' | 'code'> & { status?: 401 | 403 };

export class ProviderAuthError extends ProviderError {
  override readonly name = 'ProviderAuthError';

  constructor(options: AuthOpts) {
    super({
      status: options.status ?? 401,
      code: (options.status ?? 401) === 403 ? 'authorization' : 'authentication',
      message: options.message,
      ...(options.cause !== undefined ? { cause: options.cause } : {}),
      ...(options.providerCode !== undefined ? { providerCode: options.providerCode } : {}),
      ...(options.details !== undefined ? { details: options.details } : {}),
    });
  }
}
