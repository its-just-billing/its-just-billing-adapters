import { ProviderError, type ProviderErrorOptions } from './base.js';

export interface ProviderUnmanagedStateErrorOptions
  extends Omit<ProviderErrorOptions, 'status' | 'code'> {
  /** Dotted path of the field that triggered the detection (e.g. "subscription.schedule"). */
  field: string;
  /** What the adapter expected to find (a marker, a managed metadata key, etc.). */
  expected?: string;
  /** What was actually present on the provider. */
  found?: unknown;
}

/**
 * Thrown when an adapter reads a resource and detects state that was created
 * outside the SDK — e.g. a subscription with phases the SDK didn't author,
 * a price whose quantity constraint disagrees with the adapter-managed
 * metadata, or a webhook endpoint missing our marker.
 *
 * The SDK's normalized behavior contract holds only for state the SDK
 * manages. When a caller (or someone in the provider dashboard) modifies a
 * resource through a path the SDK doesn't own, that resource may not map
 * cleanly into the normalized model.
 *
 * Catching this error is the caller's signal that they've drifted outside
 * the SDK's lifecycle. Typical handling: log loudly, surface to the operator,
 * fall back to the raw provider client (`provider.raw`), and stop assuming
 * cross-provider normalization for that resource.
 */
export class ProviderUnmanagedStateError extends ProviderError {
  override readonly name = 'ProviderUnmanagedStateError';
  readonly field: string;
  readonly expected: string | undefined;
  readonly found: unknown;

  constructor(options: ProviderUnmanagedStateErrorOptions) {
    super({
      status: 422,
      code: 'unmanaged_state',
      message: options.message,
      ...(options.cause !== undefined ? { cause: options.cause } : {}),
      ...(options.providerCode !== undefined ? { providerCode: options.providerCode } : {}),
      ...(options.details !== undefined ? { details: options.details } : {}),
    });
    this.field = options.field;
    this.expected = options.expected;
    this.found = options.found;
  }
}
