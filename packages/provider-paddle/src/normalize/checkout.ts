import {
  type AppliedDiscount,
  type CheckoutLineItem,
  type CheckoutSessionStatus,
  type ProviderCheckoutSession,
  ProviderNormalizationError,
  normalizeCurrency,
} from '@its-just-billing/provider-sdk';
import type { Transaction } from '@paddle/paddle-node-sdk';
import { PADDLE_RESERVED, paddleCustomDataToMetadata } from '../metadata.js';
import type { PaddleCheckoutPresentation } from '../presentation.js';

/**
 * Paddle has no checkout-session object — a checkout is bootstrapped from a
 * transaction (see `presentation.ts`). The SDK's checkout-session status is
 * derived from the transaction lifecycle:
 *   - `completed` / `paid`  → `complete` (the buyer finished and was charged)
 *   - `canceled`            → `expired`  (the checkout will never complete)
 *   - everything else       → `open`     (draft/ready/billed/past_due — the
 *     buyer can still pay)
 */
function statusOf(t: Transaction): CheckoutSessionStatus {
  if (t.status === 'completed' || t.status === 'paid') return 'complete';
  if (t.status === 'canceled') return 'expired';
  return 'open';
}

/**
 * Build the Paddle-specific presentation. When Paddle returns a hosted
 * checkout URL (the seller has a default payment link configured) we hand
 * that back; otherwise the frontend must open Paddle.js with the transaction
 * id + a client-side token, so we surface the `paddle_overlay` variant.
 *
 * The client-side token is NOT available on the transaction object and the
 * checkout domain does not pre-fetch one (pure pass-through, like Stripe's
 * checkout.ts). The overlay variant therefore carries an empty `clientToken`;
 * the consumer mints/holds its own client-side token (it already needs one to
 * initialize Paddle.js) and pairs it with this `transactionId`. Documented for
 * live-sandbox verification — Paddle's API has no per-transaction client token
 * to source here.
 */
function presentationOf(t: Transaction): PaddleCheckoutPresentation {
  const url = t.checkout?.url ?? null;
  if (url) return { kind: 'paddle_hosted', url };
  return { kind: 'paddle_overlay', transactionId: t.id, clientToken: '' };
}

/**
 * `lineItems` from the transaction's `items[]` (priceId + quantity). Paddle
 * items reference a `Price | null`; a missing price reference is a hard
 * normalization error — the SDK contract requires every line to carry a
 * refetchable price id.
 */
function lineItemsOf(t: Transaction): CheckoutLineItem[] {
  return t.items.map((it) => {
    const priceId = it.price?.id;
    if (typeof priceId !== 'string' || priceId.length === 0) {
      throw new ProviderNormalizationError({
        message: `Paddle transaction ${t.id} has a checkout line item with no price reference`,
      });
    }
    return { priceId, quantity: it.quantity };
  });
}

/**
 * Single applied discount, if one resolved on the transaction. Paddle scopes
 * at most one discount per transaction (`discountId` + the expanded
 * `discount`); `details.totals.discount` is its minor-unit contribution. Empty
 * until a discount actually resolves (e.g. a `allowPromotionCodes`-style
 * checkout stays empty until the buyer enters a code).
 */
function appliedDiscountsOf(t: Transaction): AppliedDiscount[] {
  if (t.discountId === null) return [];
  const totals = t.details?.totals;
  if (!totals) return [];
  const discounted = Number.parseInt(totals.discount, 10);
  if (!Number.isFinite(discounted) || discounted <= 0) return [];
  return [
    {
      discountId: t.discountId,
      code: t.discount?.code ?? null,
      amountDiscounted: {
        amount: discounted,
        currency: normalizeCurrency(totals.currencyCode),
      },
    },
  ];
}

/**
 * Normalize a Paddle Transaction into the SDK's ProviderCheckoutSession.
 *
 * `successUrl`/`cancelUrl`: Paddle does not persist a caller-supplied
 * success/cancel URL on the transaction, so the checkout domain stashes them
 * in managed `customData` and they are read back here (round-trip). For a
 * transaction created outside the adapter the keys are absent: fall back to
 * the hosted checkout URL (or a deterministic placeholder) for the
 * schema-required `successUrl`, and `null` for `cancelUrl`.
 */
export function normalizePaddleCheckoutTransaction(
  txn: Transaction,
): ProviderCheckoutSession<PaddleCheckoutPresentation, Transaction> {
  const lineItems = lineItemsOf(txn);
  if (lineItems.length === 0) {
    throw new ProviderNormalizationError({
      message: `Paddle transaction ${txn.id} has no line items to build a checkout session from`,
    });
  }
  const cd = txn.customData as Record<string, unknown> | null;
  const managedSuccess = cd?.[PADDLE_RESERVED.CHECKOUT_SUCCESS_URL];
  const managedCancel = cd?.[PADDLE_RESERVED.CHECKOUT_CANCEL_URL];
  const successUrl =
    typeof managedSuccess === 'string' && managedSuccess.length > 0
      ? managedSuccess
      : (txn.checkout?.url ?? `https://paddle.com/checkout/${txn.id}`);
  const cancelUrl = typeof managedCancel === 'string' ? managedCancel : null;
  return {
    id: txn.id,
    status: statusOf(txn),
    customerId: txn.customerId,
    lineItems,
    successUrl,
    cancelUrl,
    appliedDiscounts: appliedDiscountsOf(txn),
    metadata: paddleCustomDataToMetadata(txn.customData),
    // Paddle transactions have no checkout-expiry timestamp.
    expiresAt: null,
    createdAt: new Date(txn.createdAt),
    presentation: presentationOf(txn),
    raw: txn,
  };
}
