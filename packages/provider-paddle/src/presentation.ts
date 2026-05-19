/**
 * Paddle-specific checkout presentation. Paddle Billing has no server-created
 * "checkout session" object like Stripe; a checkout is bootstrapped from a
 * **transaction**:
 *
 *  - `paddle_hosted` — the seller has a default payment link configured, so
 *    Paddle returns `transaction.checkout.url`; the adapter hands that back
 *    and the buyer completes payment on Paddle's hosted page.
 *  - `paddle_overlay` — no hosted URL is available; the frontend opens
 *    Paddle.js with the `transactionId` + a client-side token to render the
 *    inline/overlay checkout.
 *
 * The shape is opaque to the conformance suite; it only asserts presence. The
 * harness's `checkoutUrl` maps the `paddle_hosted` variant to an openable URL
 * for the semi-manual "press O to open" affordance.
 */
export type PaddleCheckoutPresentation =
  | { kind: 'paddle_hosted'; url: string }
  | { kind: 'paddle_overlay'; transactionId: string; clientToken: string };
