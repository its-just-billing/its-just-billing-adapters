import { ProviderError, type ProviderErrorOptions } from './base.js';

export interface ProviderRateLimitErrorOptions extends Omit<ProviderErrorOptions, 'status' | 'code'> {
  retryAfterSeconds?: number;
}

export class ProviderRateLimitError extends ProviderError {
  override readonly name = 'ProviderRateLimitError';
  readonly retryAfterSeconds: number | undefined;

  constructor(options: ProviderRateLimitErrorOptions) {
    super({
      status: 429,
      code: 'rate_limit',
      message: options.message,
      ...(options.cause !== undefined ? { cause: options.cause } : {}),
      ...(options.providerCode !== undefined ? { providerCode: options.providerCode } : {}),
      ...(options.details !== undefined ? { details: options.details } : {}),
    });
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}
