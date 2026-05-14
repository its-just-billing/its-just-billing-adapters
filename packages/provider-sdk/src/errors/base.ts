export type ProviderErrorCode =
  | 'validation'
  | 'authentication'
  | 'authorization'
  | 'not_found'
  | 'conflict'
  | 'constraint'
  | 'rate_limit'
  | 'unavailable'
  | 'webhook_signature'
  | 'normalization'
  | 'metadata_collision'
  | 'unmanaged_state'
  | 'not_supported'
  | 'unknown';

export interface ProviderErrorOptions {
  status: number;
  code: ProviderErrorCode;
  message: string;
  cause?: unknown;
  providerCode?: string;
  details?: Record<string, unknown>;
}

export class ProviderError extends Error {
  override readonly name: string = 'ProviderError';
  readonly status: number;
  readonly code: ProviderErrorCode;
  readonly providerCode: string | undefined;
  readonly details: Record<string, unknown> | undefined;

  constructor(options: ProviderErrorOptions) {
    super(options.message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.status = options.status;
    this.code = options.code;
    this.providerCode = options.providerCode;
    this.details = options.details;
  }

  toJSON(): {
    name: string;
    status: number;
    code: ProviderErrorCode;
    message: string;
    providerCode?: string;
    details?: Record<string, unknown>;
  } {
    const out: ReturnType<ProviderError['toJSON']> = {
      name: this.name,
      status: this.status,
      code: this.code,
      message: this.message,
    };
    if (this.providerCode !== undefined) out.providerCode = this.providerCode;
    if (this.details !== undefined) out.details = this.details;
    return out;
  }
}

export function isProviderError(value: unknown): value is ProviderError {
  return value instanceof ProviderError;
}
