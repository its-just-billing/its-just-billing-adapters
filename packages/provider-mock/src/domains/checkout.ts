import {
  type AppliedDiscount,
  type Checkout,
  type ProviderCheckoutSession,
  ProviderConstraintError,
  ProviderNotFoundError,
  Schemas,
  assertNoReservedKeys,
  assertQuantityWithinConstraint,
  stripReservedKeys,
  validate,
} from '@its-just-billing/provider-sdk';
import { cloneDate } from '../clone-date.js';
import { nextId } from '../ids.js';
import type { MockCheckoutPresentation } from '../presentation.js';
import type {
  InternalAppliedDiscount,
  InternalCheckoutSession,
  InternalDiscount,
  MockState,
} from '../state.js';

function normalize(s: InternalCheckoutSession): ProviderCheckoutSession<MockCheckoutPresentation> {
  return {
    id: s.id,
    status: s.status,
    customerId: s.customerId,
    lineItems: s.lineItems.map((li) => ({ priceId: li.priceId, quantity: li.quantity })),
    successUrl: s.successUrl,
    cancelUrl: s.cancelUrl,
    appliedDiscounts: s.appliedDiscounts.map(
      (d): AppliedDiscount => ({
        discountId: d.discountId,
        code: d.code,
        amountDiscounted: { ...d.amountDiscounted },
      }),
    ),
    metadata: stripReservedKeys(s.metadata),
    expiresAt: cloneDate(s.expiresAt),
    createdAt: cloneDate(s.createdAt),
    presentation: { kind: 'mock_hosted', url: `https://mock.invalid/checkout/${s.id}` },
  };
}

/**
 * Compute a single applied-discount line for a resolved discount against the
 * line-item subtotal. Percent: `floor(subtotal * percentOff / 100)`. Amount:
 * `min(amountOff, subtotal)` (clamped so a $50-off coupon on a $20 cart
 * discounts $20, not $50; the contract says final amount must be non-negative).
 *
 * For an amount discount the caller has already validated the currency matches
 * the session's currency.
 */
function computeAppliedDiscount(
  discount: InternalDiscount,
  subtotalMinor: number,
  currency: string,
): InternalAppliedDiscount {
  let amountMinor: number;
  if (discount.benefit.kind === 'percent') {
    amountMinor = Math.floor((subtotalMinor * discount.benefit.percentOff) / 100);
  } else {
    amountMinor = Math.min(discount.benefit.amountOff.amount, subtotalMinor);
  }
  return {
    discountId: discount.id,
    code: discount.code,
    amountDiscounted: { amount: amountMinor, currency },
  };
}

export function createCheckoutDomain(state: MockState): Checkout<MockCheckoutPresentation> {
  return {
    async createSession(input) {
      const parsed = validate(
        Schemas.Checkout.CheckoutCreateSessionInputSchema,
        input,
        'checkout.createSession',
      );
      assertNoReservedKeys(parsed.metadata, 'checkout.createSession');

      let sessionCurrency: string | null = null;
      let lineItemSubtotalMinor = 0;
      for (const li of parsed.lineItems) {
        const price = state.prices.get(li.priceId);
        if (!price) {
          throw new ProviderNotFoundError({
            message: `Price ${li.priceId} not found`,
          });
        }
        if (!price.active) {
          throw new ProviderConstraintError({
            message: `Price ${price.id} is inactive`,
          });
        }
        if (sessionCurrency === null) {
          sessionCurrency = price.currency;
        } else if (price.currency !== sessionCurrency) {
          throw new ProviderConstraintError({
            message: `Line items mix currencies (${sessionCurrency} and ${price.currency}); a checkout session must use a single currency`,
            details: { expected: sessionCurrency, found: price.currency },
          });
        }
        assertQuantityWithinConstraint(li.quantity, price.quantity, 'checkout.createSession');
        lineItemSubtotalMinor += price.spec.unitAmount * li.quantity;
      }

      if (parsed.customerId) {
        const customer = state.customers.get(parsed.customerId);
        if (!customer || customer.archived) {
          throw new ProviderNotFoundError({
            message: `Customer ${parsed.customerId} not found`,
          });
        }
      }

      // Resolve the discount input (if any) into the persisted applied-discount
      // list. `kind: 'allowPromotionCodes'` doesn't resolve anything at create
      // time — the customer enters a code in the hosted UI later, and the
      // session reflects it on subsequent reads. The mock has no hosted UI to
      // simulate that handoff, so we leave the array empty in that case.
      const appliedDiscounts: InternalAppliedDiscount[] = [];
      if (parsed.discount) {
        if (parsed.discount.kind === 'discountId') {
          const discount = state.discounts.get(parsed.discount.discountId);
          if (!discount) {
            throw new ProviderNotFoundError({
              message: `Discount ${parsed.discount.discountId} not found`,
            });
          }
          if (!discount.active) {
            throw new ProviderConstraintError({
              message: `Discount ${discount.id} is inactive`,
            });
          }
          if (
            discount.benefit.kind === 'amount' &&
            sessionCurrency !== null &&
            discount.benefit.amountOff.currency !== sessionCurrency
          ) {
            throw new ProviderConstraintError({
              message: `Discount ${discount.id} currency ${discount.benefit.amountOff.currency} does not match session currency ${sessionCurrency}`,
              details: {
                expected: sessionCurrency,
                found: discount.benefit.amountOff.currency,
              },
            });
          }
          if (sessionCurrency !== null) {
            appliedDiscounts.push(
              computeAppliedDiscount(discount, lineItemSubtotalMinor, sessionCurrency),
            );
          }
        } else if (parsed.discount.kind === 'code') {
          let match: InternalDiscount | undefined;
          for (const d of state.discounts.values()) {
            if (d.code === parsed.discount.code) {
              match = d;
              break;
            }
          }
          if (!match) {
            throw new ProviderNotFoundError({
              message: `Discount code ${parsed.discount.code} not found`,
            });
          }
          if (!match.active) {
            throw new ProviderConstraintError({
              message: `Discount code ${parsed.discount.code} is inactive`,
            });
          }
          if (
            match.benefit.kind === 'amount' &&
            sessionCurrency !== null &&
            match.benefit.amountOff.currency !== sessionCurrency
          ) {
            throw new ProviderConstraintError({
              message: `Discount ${match.id} currency ${match.benefit.amountOff.currency} does not match session currency ${sessionCurrency}`,
              details: {
                expected: sessionCurrency,
                found: match.benefit.amountOff.currency,
              },
            });
          }
          if (sessionCurrency !== null) {
            appliedDiscounts.push(
              computeAppliedDiscount(match, lineItemSubtotalMinor, sessionCurrency),
            );
          }
        }
        // 'allowPromotionCodes' falls through; appliedDiscounts stays [].
      }

      const record: InternalCheckoutSession = {
        id: nextId('cs'),
        status: 'open',
        customerId: parsed.customerId ?? null,
        lineItems: parsed.lineItems.map((li) => ({ priceId: li.priceId, quantity: li.quantity })),
        successUrl: parsed.successUrl,
        cancelUrl: parsed.cancelUrl ?? null,
        appliedDiscounts,
        trial: parsed.trial ? { count: parsed.trial.count, unit: parsed.trial.unit } : null,
        metadata: { ...(parsed.metadata ?? {}) },
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        createdAt: new Date(),
      };
      state.checkoutSessions.set(record.id, record);
      return normalize(record);
    },

    async getSession(input) {
      const parsed = validate(
        Schemas.Checkout.CheckoutGetSessionInputSchema,
        input,
        'checkout.getSession',
      );
      const s = state.checkoutSessions.get(parsed.id);
      return s ? normalize(s) : null;
    },
  };
}
