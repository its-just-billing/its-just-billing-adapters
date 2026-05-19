import {
  type PaymentStatus,
  type Payments,
  Schemas,
  validate,
} from '@its-just-billing/provider-sdk';
import type { Paddle, Transaction, TransactionStatus } from '@paddle/paddle-node-sdk';
import { isPaddleMissingReference, mapPaddleError } from '../error-mapping.js';
import { normalizePaddleTransaction } from '../normalize/payment.js';
import { pageFromPaddleCollection } from '../pagination.js';

// A "payment" is a Paddle transaction that actually moved money. The default
// list scope is therefore the paid/completed statuses; `draft`/`ready` etc.
// are payable-but-unsettled and aren't payments yet.
const PAID_STATUSES: TransactionStatus[] = ['completed', 'paid'];

// `include=discount` expands the applied discount so the normalizer can
// surface its `code`; `adjustments_totals` aggregates refunds so the
// normalizer can compute `amountRefunded` and the refunded status. Both are
// same-request expands (no extra round trips). Typed to the list query's
// `include` element union so a Paddle SDK rename is a compile error.
const PAYMENT_INCLUDE: NonNullable<
  NonNullable<Parameters<Paddle['transactions']['list']>[0]>['include']
> = ['discount', 'adjustments_totals'];

/**
 * Translate the SDK's `PaymentStatus` filter into Paddle transaction
 * statuses. `refunded`/`partially_refunded` have no native Paddle status (a
 * refund is an adjustment layered on a completed transaction), so they map to
 * the paid statuses and are refined client-side after normalization.
 */
function paddleStatusesFor(status: PaymentStatus): TransactionStatus[] {
  switch (status) {
    case 'succeeded':
    case 'refunded':
    case 'partially_refunded':
      return ['completed', 'paid'];
    case 'pending':
      return ['draft', 'ready', 'billed', 'past_due'];
    case 'failed':
      return ['canceled'];
  }
}

export function createPaymentsDomain(paddle: Paddle): Payments<Transaction> {
  return {
    async list(input) {
      const parsed =
        input !== undefined
          ? validate(Schemas.Payments.PaymentsListInputSchema, input, 'payments.list')
          : undefined;
      const statuses =
        parsed?.status !== undefined ? paddleStatusesFor(parsed.status) : PAID_STATUSES;
      try {
        const collection = paddle.transactions.list({
          status: statuses,
          include: PAYMENT_INCLUDE,
          ...(parsed?.cursor !== undefined ? { after: parsed.cursor } : {}),
          ...(parsed?.limit !== undefined ? { perPage: parsed.limit } : {}),
          ...(parsed?.customerId !== undefined ? { customerId: [parsed.customerId] } : {}),
        });
        const page = await pageFromPaddleCollection(collection, normalizePaddleTransaction);
        // `refunded`/`partially_refunded` aren't a Paddle status; the refund
        // overlay is computed during normalization. Apply the precise filter
        // client-side. `nextCursor` still references the last raw item so
        // forward pagination keeps making progress even if the page shrinks.
        if (parsed?.status === 'refunded' || parsed?.status === 'partially_refunded') {
          return {
            data: page.data.filter((p) => p.status === parsed.status),
            nextCursor: page.nextCursor,
          };
        }
        return page;
      } catch (err) {
        // An unknown customer filter surfaces as not-found; the SDK list
        // contract is "filtered set, possibly empty" — return a clean empty
        // page rather than propagating.
        if (parsed?.customerId !== undefined && isPaddleMissingReference(err)) {
          return { data: [], nextCursor: null };
        }
        throw mapPaddleError(err, 'payments.list');
      }
    },

    async get(input) {
      const parsed = validate(Schemas.Payments.PaymentsGetInputSchema, input, 'payments.get');
      try {
        const native = await paddle.transactions.get(parsed.id, {
          include: ['discount', 'adjustments_totals'],
        });
        return normalizePaddleTransaction(native);
      } catch (err) {
        if (isPaddleMissingReference(err)) return null;
        throw mapPaddleError(err, 'payments.get');
      }
    },
  };
}
