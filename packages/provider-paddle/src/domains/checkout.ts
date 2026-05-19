import {
  type Checkout,
  ProviderNotSupportedError,
  Schemas,
  assertCapabilityValueSupported,
  assertNoReservedKeys,
  validate,
} from '@its-just-billing/provider-sdk';
import type {
  CreateTransactionRequestBody,
  ITransactionItemWithNonCatalogPrice,
  Paddle,
  Transaction,
} from '@paddle/paddle-node-sdk';
import { PADDLE_CAPABILITIES } from '../capabilities.js';
import { isPaddleNotFound, mapPaddleError } from '../error-mapping.js';
import { PADDLE_RESERVED } from '../metadata.js';
import { normalizePaddleCheckoutTransaction } from '../normalize/checkout.js';
import type { PaddleCheckoutPresentation } from '../presentation.js';

// `include=discount` expands the applied `Discount` so the normalizer can
// surface its `code` on `appliedDiscounts`. Same-request expand — zero extra
// round-trips. (`adjustments_totals` is irrelevant on a fresh checkout
// transaction; only the payment read needs it.)
const CHECKOUT_INCLUDE: NonNullable<
  NonNullable<Parameters<Paddle['transactions']['create']>[1]>['include']
> = ['discount'];

/**
 * `hostedCheckoutUrl` (from `PADDLE_HOSTED_CHECKOUT_URL`) is the base hosted-
 * checkout link a buyer is sent to (a Paddle-hosted payment link such as
 * `https://…paddle.io/hsc_…`, or your own Paddle.js page). A hosted checkout
 * is opened for a specific transaction by appending `?_ptxn=<transactionId>`
 * — so the adapter builds the `paddle_hosted` presentation URL itself and
 * does NOT pass `checkout.url` to the transaction API. (That field is only
 * for a domain you've had Paddle approve; a Paddle-hosted `paddle.io` link is
 * rejected there.) When unset, the presentation falls back to whatever
 * `transaction.checkout.url` Paddle attaches from the account default payment
 * link, or `paddle_overlay` when there is none.
 */
function withTransactionId(baseUrl: string, transactionId: string): string {
  try {
    const u = new URL(baseUrl);
    u.searchParams.set('_ptxn', transactionId);
    return u.toString();
  } catch {
    // Not a parseable absolute URL — fall back to a plain query append so a
    // misconfigured value still yields a deterministic, inspectable link.
    const sep = baseUrl.includes('?') ? '&' : '?';
    return `${baseUrl}${sep}_ptxn=${encodeURIComponent(transactionId)}`;
  }
}

export function createCheckoutDomain(
  paddle: Paddle,
  hostedCheckoutUrl?: string,
): Checkout<PaddleCheckoutPresentation, Transaction> {
  return {
    async createSession(input) {
      const parsed = validate(
        Schemas.Checkout.CheckoutCreateSessionInputSchema,
        input,
        'checkout.createSession',
      );
      assertNoReservedKeys(parsed.metadata, 'checkout.createSession');

      // Pure pass-through: map normalized fields straight onto Paddle's
      // transaction create call and let Paddle accept/reject. No pre-flight
      // retrieves — the consumer holds price recurrence/quantity/currency in
      // its own persistence. `mode` is caller-supplied and informational on
      // Paddle (recurrence is intrinsic to the referenced price; Paddle does
      // not take a session "mode"), so it's accepted and not forwarded.
      void parsed.mode;

      // Discount:
      //   - `discountId` kind → Paddle's catalog `discountId` on the txn.
      //   - `allowPromotionCodes` kind → no transaction field. Paddle's hosted
      //     checkout already lets the buyer enter a discount code when the
      //     seller has checkout-enabled discounts; there is nothing to set
      //     here, so this is an accepted no-op (documented for live-sandbox
      //     verification).
      let discountId: string | undefined;
      if (parsed.discount && parsed.discount.kind === 'discountId') {
        discountId = parsed.discount.discountId;
      }

      // Trial: Paddle models trials on the *price* (`price.trialPeriod`), not
      // on a transaction — a catalog-priced checkout has no trial-override
      // field. Honoring a checkout-level trial here is impossible, so reject
      // it instead of silently dropping it (which would hand back a
      // trial-less subscription while the caller believed a trial applied).
      // `trialUnits` still advertises Paddle's price-level trial support; the
      // consumer applies the trial on the price it references.
      if (parsed.trial !== undefined) {
        // Keep the unit capability gate first for parity/clear errors.
        assertCapabilityValueSupported(
          PADDLE_CAPABILITIES.trialUnits,
          parsed.trial.unit,
          'trial.unit',
          'checkout.createSession',
        );
        throw new ProviderNotSupportedError({
          feature: 'checkout.trial',
          value: `${parsed.trial.count} ${parsed.trial.unit}`,
          message:
            'checkout.createSession: Paddle has no checkout-level trial on a catalog-priced ' +
            'transaction — model the trial on the referenced price (price.trialPeriod) instead.',
        });
      }

      const items: ITransactionItemWithNonCatalogPrice[] = parsed.lineItems.map((li) => ({
        priceId: li.priceId,
        quantity: li.quantity,
      }));

      // Paddle transactions don't persist the caller's success/cancel URLs,
      // so round-trip them (plus caller metadata) through managed
      // `customData`. The normalizer strips the reserved keys back out, so
      // caller-visible `metadata` stays exactly what was passed.
      const customData: Record<string, string> = {
        ...(parsed.metadata ?? {}),
        [PADDLE_RESERVED.CHECKOUT_SUCCESS_URL]: parsed.successUrl,
        ...(parsed.cancelUrl !== undefined
          ? { [PADDLE_RESERVED.CHECKOUT_CANCEL_URL]: parsed.cancelUrl }
          : {}),
      };

      const body: CreateTransactionRequestBody = {
        items,
        customData,
        ...(parsed.customerId !== undefined ? { customerId: parsed.customerId } : {}),
        ...(discountId !== undefined ? { discountId } : {}),
        // `checkout.url` is intentionally NOT sent — see `withTransactionId`.
        // Paddle only accepts an account-approved domain there; the hosted
        // checkout link is applied to the presentation below instead.
      };

      try {
        const native = await paddle.transactions.create(body, {
          include: CHECKOUT_INCLUDE,
        });
        const session = normalizePaddleCheckoutTransaction(native);
        // When a hosted-checkout link is configured, it is authoritative:
        // build the openable URL by binding the transaction id to it, rather
        // than relying on the account default Paddle attaches.
        if (hostedCheckoutUrl !== undefined) {
          session.presentation = {
            kind: 'paddle_hosted',
            url: withTransactionId(hostedCheckoutUrl, native.id),
          };
        }
        return session;
      } catch (err) {
        throw mapPaddleError(err, 'checkout.createSession');
      }
    },

    async getSession(input) {
      const parsed = validate(
        Schemas.Checkout.CheckoutGetSessionInputSchema,
        input,
        'checkout.getSession',
      );
      try {
        const native = await paddle.transactions.get(parsed.id, {
          include: ['discount'],
        });
        return normalizePaddleCheckoutTransaction(native);
      } catch (err) {
        if (isPaddleNotFound(err)) return null;
        throw mapPaddleError(err, 'checkout.getSession');
      }
    },
  };
}
