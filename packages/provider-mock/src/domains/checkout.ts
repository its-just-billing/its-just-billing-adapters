import {
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
import type { InternalCheckoutSession, MockState } from '../state.js';

function normalize(s: InternalCheckoutSession): ProviderCheckoutSession<MockCheckoutPresentation> {
  return {
    id: s.id,
    status: s.status,
    customerId: s.customerId,
    lineItems: s.lineItems.map((li) => ({ priceId: li.priceId, quantity: li.quantity })),
    successUrl: s.successUrl,
    cancelUrl: s.cancelUrl,
    metadata: stripReservedKeys(s.metadata),
    expiresAt: cloneDate(s.expiresAt),
    createdAt: cloneDate(s.createdAt),
    presentation: { kind: 'mock_hosted', url: `https://mock.invalid/checkout/${s.id}` },
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
      }

      if (parsed.customerId) {
        const customer = state.customers.get(parsed.customerId);
        if (!customer || customer.archived) {
          throw new ProviderNotFoundError({
            message: `Customer ${parsed.customerId} not found`,
          });
        }
      }

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
        } else if (parsed.discount.kind === 'code') {
          let match: typeof state.discounts extends Map<string, infer V> ? V | undefined : never;
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
        }
      }

      const record: InternalCheckoutSession = {
        id: nextId('cs'),
        status: 'open',
        customerId: parsed.customerId ?? null,
        lineItems: parsed.lineItems.map((li) => ({ priceId: li.priceId, quantity: li.quantity })),
        successUrl: parsed.successUrl,
        cancelUrl: parsed.cancelUrl ?? null,
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
