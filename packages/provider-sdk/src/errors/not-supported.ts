import { ProviderError, type ProviderErrorOptions } from './base.js';

export interface ProviderNotSupportedErrorOptions
  extends Omit<ProviderErrorOptions, 'status' | 'code'> {
  /** The capability axis (e.g. "taxCategory", "currency"). */
  feature: string;
  /** The value the caller supplied that the active provider can't honor. */
  value: unknown;
}

/**
 * Thrown when a caller supplies a structurally valid normalized value that
 * the active provider can't honor — e.g. a tax category outside the
 * provider's set, or a currency the provider doesn't support.
 *
 * Pre-flight equivalent: `provider.capabilities.<axis>.has(value)`.
 */
export class ProviderNotSupportedError extends ProviderError {
  override readonly name = 'ProviderNotSupportedError';
  readonly feature: string;
  readonly value: unknown;

  constructor(options: ProviderNotSupportedErrorOptions) {
    super({
      status: 422,
      code: 'not_supported',
      message: options.message,
      ...(options.cause !== undefined ? { cause: options.cause } : {}),
      ...(options.providerCode !== undefined ? { providerCode: options.providerCode } : {}),
      ...(options.details !== undefined ? { details: options.details } : {}),
    });
    this.feature = options.feature;
    this.value = options.value;
  }
}
