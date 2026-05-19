import {
  type AppliedDiscount,
  type Money,
  type PaymentStatus,
  ProviderNormalizationError,
  type ProviderPayment,
  normalizeCurrency,
} from '@its-just-billing/provider-sdk';
import type { Transaction } from '@paddle/paddle-node-sdk';
import { paddleCustomDataToMetadata } from '../metadata.js';

/**
 * Map Paddle's transaction status onto the SDK's payment status.
 *
 *   - `completed` / `paid`  → `succeeded` (money moved; `completed` is the
 *     terminal fulfilled state, `paid` is paid-but-pre-fulfilment — both are
 *     "the customer was charged successfully").
 *   - `draft` / `ready` / `billed` / `past_due` → `pending` (a payable
 *     transaction whose money hasn't settled yet).
 *   - `canceled` → `failed` (the transaction will never collect).
 *
 * A refund is layered on top of `succeeded` from `adjustmentsTotals` (see
 * {@link normalizePaddleTransaction}); this base mapping is the pre-refund
 * state.
 */
function baseStatusOf(t: Transaction): PaymentStatus {
  switch (t.status) {
    case 'completed':
    case 'paid':
      return 'succeeded';
    case 'draft':
    case 'ready':
    case 'billed':
    case 'past_due':
      return 'pending';
    case 'canceled':
      return 'failed';
    default:
      throw new ProviderNormalizationError({
        message: `Paddle transaction ${t.id} has an unrecognized status "${String(t.status)}"`,
      });
  }
}

function parseMinor(value: string, label: string, txnId: string): number {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) {
    throw new ProviderNormalizationError({
      message: `Paddle transaction ${txnId} has an unparseable ${label} "${value}"`,
    });
  }
  return n;
}

/**
 * Normalize a Paddle Transaction into the SDK's ProviderPayment.
 *
 * Money comes from `details.totals` (a `TransactionTotals` of minor-unit
 * strings + a `currencyCode`). `grandTotal` is the amount actually charged
 * (post-discount, incl. tax); `subtotal` is the pre-discount, pre-tax base.
 *
 * Refunds: Paddle records refunds/credits as adjustments, aggregated into
 * `adjustmentsTotals`. When present and positive, that's the refunded amount;
 * the status is refined to `refunded` (full) or `partially_refunded`. The
 * domain layer requests `include=['discount','adjustments_totals']` so these
 * are populated (a same-request expand, no extra round trip).
 *
 * `appliedDiscounts`: Paddle applies at most one discount per transaction
 * (`discountId` + the expanded `discount`), and `details.totals.discount` is
 * its minor-unit contribution. We surface a single AppliedDiscount when a
 * discount id is present and the discounted amount is non-zero, mirroring the
 * Stripe normalizer's "refetchable id only" rule.
 *
 * `checkoutSessionId` is set to the transaction id: Paddle has no checkout
 * session object — a checkout is bootstrapped from a transaction, so the
 * transaction id is the correlation key the semi-manual suite uses to tie a
 * payment back to the checkout it created.
 */
export function normalizePaddleTransaction(txn: Transaction): ProviderPayment<Transaction> {
  const totals = txn.details?.totals;
  if (!totals) {
    throw new ProviderNormalizationError({
      message: `Paddle transaction ${txn.id} has no details.totals to derive amount from`,
    });
  }
  const currency = normalizeCurrency(totals.currencyCode);
  const amount: Money = {
    amount: parseMinor(totals.grandTotal, 'grandTotal', txn.id),
    currency,
  };
  const subtotal: Money = {
    amount: parseMinor(totals.subtotal, 'subtotal', txn.id),
    currency,
  };

  // Refund overlay from aggregated adjustments.
  let status = baseStatusOf(txn);
  let amountRefunded: Money | null = null;
  const adj = txn.adjustmentsTotals;
  if (adj) {
    const refunded = parseMinor(adj.total, 'adjustmentsTotals.total', txn.id);
    if (refunded > 0) {
      amountRefunded = { amount: refunded, currency };
      if (status === 'succeeded') {
        status = refunded >= amount.amount ? 'refunded' : 'partially_refunded';
      }
    }
  }

  // Single applied discount (Paddle scopes one discount per transaction).
  const appliedDiscounts: AppliedDiscount[] = [];
  if (txn.discountId !== null) {
    const discounted = parseMinor(totals.discount, 'totals.discount', txn.id);
    if (discounted > 0) {
      appliedDiscounts.push({
        discountId: txn.discountId,
        code: txn.discount?.code ?? null,
        amountDiscounted: { amount: discounted, currency },
      });
    }
  }

  // Paddle transactions reference price/product only through line items
  // (`details.lineItems[].priceId` / `.product.id`). Surface the first line's
  // ids for the common single-line one-time payment; multi-line carts leave
  // callers to walk `raw.details.lineItems`.
  const firstLine = txn.details?.lineItems?.[0];
  const priceId = firstLine?.priceId ?? null;
  const productId = firstLine?.product?.id ?? null;

  return {
    id: txn.id,
    customerId: txn.customerId,
    status,
    amount,
    subtotal,
    amountRefunded,
    appliedDiscounts,
    priceId,
    productId,
    checkoutSessionId: txn.id,
    metadata: paddleCustomDataToMetadata(txn.customData),
    createdAt: new Date(txn.createdAt),
    raw: txn,
  };
}
