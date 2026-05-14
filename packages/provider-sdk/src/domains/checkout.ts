import type {
  CheckoutCreateSessionInput,
  CheckoutCreateSessionOutput,
  CheckoutGetSessionInput,
  CheckoutGetSessionOutput,
} from '../schemas/checkout/index.js';

/**
 * Checkout sessions carry a provider-specific `presentation` payload so each
 * adapter can supply whatever the caller needs to render or redirect (hosted
 * URL, embedded client secret, frontend SDK token, etc).
 *
 * `TPresentation` is the concrete presentation shape exposed by the adapter.
 * Adapter-agnostic code uses `Checkout<unknown>`; consumers that know which
 * adapter they're talking to narrow to `Checkout<StripeCheckoutPresentation>`
 * (etc.) to get full type information.
 */
export interface Checkout<TPresentation = unknown> {
  createSession(
    input: CheckoutCreateSessionInput,
  ): Promise<CheckoutCreateSessionOutput<TPresentation>>;
  getSession(input: CheckoutGetSessionInput): Promise<CheckoutGetSessionOutput<TPresentation>>;
}
