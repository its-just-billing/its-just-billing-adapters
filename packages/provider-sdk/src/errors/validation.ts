import { ProviderError, type ProviderErrorOptions } from './base.js';

export interface ValidationIssue {
  path: (string | number)[];
  message: string;
  code?: string;
}

export interface ProviderValidationErrorOptions
  extends Omit<ProviderErrorOptions, 'status' | 'code'> {
  issues: ValidationIssue[];
}

export class ProviderValidationError extends ProviderError {
  override readonly name = 'ProviderValidationError';
  readonly issues: ValidationIssue[];

  constructor(options: ProviderValidationErrorOptions) {
    super({
      status: 400,
      code: 'validation',
      message: options.message,
      ...(options.cause !== undefined ? { cause: options.cause } : {}),
      ...(options.providerCode !== undefined ? { providerCode: options.providerCode } : {}),
      ...(options.details !== undefined ? { details: options.details } : {}),
    });
    this.issues = options.issues;
  }
}
