/**
 * Stripe-specific checkout presentation. Stripe Checkout supports two UI modes:
 *
 *  - `hosted` — Stripe redirects the user to a Stripe-rendered page; the
 *    adapter returns the URL.
 *  - `embedded` — the merchant renders Stripe's iframe; the adapter returns
 *    a client secret the frontend uses to mount `<EmbeddedCheckoutProvider>`.
 *
 * The shape is opaque to the conformance suite; it only asserts presence.
 */
export type StripeCheckoutPresentation =
  | { kind: 'stripe_hosted'; url: string }
  | { kind: 'stripe_embedded'; clientSecret: string };
