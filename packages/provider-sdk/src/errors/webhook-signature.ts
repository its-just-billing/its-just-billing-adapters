import { ProviderError, type ProviderErrorOptions } from './base.js';

export class WebhookSignatureError extends ProviderError {
  override readonly name = 'WebhookSignatureError';

  constructor(options: Omit<ProviderErrorOptions, 'status' | 'code'>) {
    super({
      status: 400,
      code: 'webhook_signature',
      message: options.message,
      ...(options.cause !== undefined ? { cause: options.cause } : {}),
      ...(options.providerCode !== undefined ? { providerCode: options.providerCode } : {}),
      ...(options.details !== undefined ? { details: options.details } : {}),
    });
  }
}
