import { ProviderError, type ProviderErrorOptions } from './base.js';

export interface MetadataCollisionErrorOptions
  extends Omit<ProviderErrorOptions, 'status' | 'code'> {
  reservedKeys: string[];
}

export class MetadataCollisionError extends ProviderError {
  override readonly name = 'MetadataCollisionError';
  readonly reservedKeys: string[];

  constructor(options: MetadataCollisionErrorOptions) {
    super({
      status: 422,
      code: 'metadata_collision',
      message: options.message,
      ...(options.cause !== undefined ? { cause: options.cause } : {}),
      ...(options.providerCode !== undefined ? { providerCode: options.providerCode } : {}),
      ...(options.details !== undefined ? { details: options.details } : {}),
    });
    this.reservedKeys = options.reservedKeys;
  }
}
