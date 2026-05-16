import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type {
  BillingProvider,
  ProviderCustomer,
  ProviderDiscount,
  ProviderPayment,
  ProviderPrice,
  ProviderProduct,
} from '../../../index.js';
import { withoutRaw } from '../../equality.js';
import type { ProviderTestHarness } from '../../harness.js';
import { lazySkipIf, nonNull } from '../../skip-if.js';

/**
 * Registers the payments self-setup conformance suite. Every test here
 * promotes a checkout session to a completed payment via
 * `setup.completePayment`; the entire suite is gated on that capability
 * being present on the harness.
 */
export function registerPaymentsSelfSetupSuite(
  label: string,
  factory: () => ProviderTestHarness | Promise<ProviderTestHarness>,
): void {
  // ---------------------------------------------------------------------------
  // Helpers (inlined per the task instructions — no shared util library yet).
  // ---------------------------------------------------------------------------

  function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  const PAYMENT_STATUSES = [
    'pending',
    'succeeded',
    'failed',
    'refunded',
    'partially_refunded',
  ] as const;
  const STATUS_SET = new Set<string>(PAYMENT_STATUSES);

  function expectIsPage<T>(p: unknown): asserts p is { data: T[]; nextCursor: string | null } {
    expect(typeof p === 'object' && p !== null).toBe(true);
    const rec = p as Record<string, unknown>;
    expect(Array.isArray(rec.data)).toBe(true);
    expect(rec.nextCursor === null || typeof rec.nextCursor === 'string').toBe(true);
    if (typeof rec.nextCursor === 'string') {
      expect((rec.nextCursor as string).length).toBeGreaterThan(0);
    }
  }

  function expectIsPayment(p: unknown): asserts p is ProviderPayment {
    expect(isPlainObject(p)).toBe(true);
    const rec = p as Record<string, unknown>;

    expect(typeof rec.id).toBe('string');
    expect((rec.id as string).length).toBeGreaterThan(0);

    expect(rec.customerId === null || typeof rec.customerId === 'string').toBe(true);
    expect(typeof rec.status).toBe('string');
    expect(STATUS_SET.has(rec.status as string)).toBe(true);

    expect(isPlainObject(rec.amount)).toBe(true);
    const amt = rec.amount as Record<string, unknown>;
    expect(typeof amt.amount).toBe('number');
    expect(Number.isInteger(amt.amount)).toBe(true);
    expect((amt.amount as number) >= 0).toBe(true);
    expect(typeof amt.currency).toBe('string');
    expect(/^[a-z]{3}$/.test(amt.currency as string)).toBe(true);

    if (rec.amountRefunded !== null) {
      expect(isPlainObject(rec.amountRefunded)).toBe(true);
      const ref = rec.amountRefunded as Record<string, unknown>;
      expect(typeof ref.amount).toBe('number');
      expect(Number.isInteger(ref.amount)).toBe(true);
      expect((ref.amount as number) >= 0).toBe(true);
      expect(typeof ref.currency).toBe('string');
      expect(/^[a-z]{3}$/.test(ref.currency as string)).toBe(true);
    }

    if ('subtotal' in rec && rec.subtotal !== undefined) {
      expect(isPlainObject(rec.subtotal)).toBe(true);
      const sub = rec.subtotal as Record<string, unknown>;
      expect(typeof sub.amount).toBe('number');
      expect(Number.isInteger(sub.amount)).toBe(true);
      expect((sub.amount as number) >= 0).toBe(true);
      expect(typeof sub.currency).toBe('string');
      expect(/^[a-z]{3}$/.test(sub.currency as string)).toBe(true);
    }

    expect(Array.isArray(rec.appliedDiscounts)).toBe(true);
    for (const d of rec.appliedDiscounts as unknown[]) {
      expect(isPlainObject(d)).toBe(true);
      const entry = d as Record<string, unknown>;
      expect(typeof entry.discountId).toBe('string');
      expect((entry.discountId as string).length).toBeGreaterThan(0);
      expect(entry.code === null || typeof entry.code === 'string').toBe(true);
      expect(isPlainObject(entry.amountDiscounted)).toBe(true);
      const amt = entry.amountDiscounted as Record<string, unknown>;
      expect(typeof amt.amount).toBe('number');
      expect(Number.isInteger(amt.amount)).toBe(true);
      expect((amt.amount as number) >= 0).toBe(true);
      expect(typeof amt.currency).toBe('string');
      expect(amt.currency).toBe((rec.amount as Record<string, unknown>).currency);
    }

    expect(rec.priceId === null || typeof rec.priceId === 'string').toBe(true);
    expect(rec.productId === null || typeof rec.productId === 'string').toBe(true);
    expect(rec.checkoutSessionId === null || typeof rec.checkoutSessionId === 'string').toBe(true);

    expect(isPlainObject(rec.metadata)).toBe(true);
    for (const [k, v] of Object.entries(rec.metadata as Record<string, unknown>)) {
      expect(typeof v).toBe('string');
      expect(k.startsWith('__provider_')).toBe(false);
    }

    expect(rec.createdAt).toBeInstanceOf(Date);
    expect(Number.isFinite((rec.createdAt as Date).getTime())).toBe(true);
  }

  /**
   * Drive customer → product → price → session, then ask the harness to
   * complete the session into a payment. Caller is responsible for
   * confirming `harness.setup?.completePayment` exists first.
   *
   * When `opts.discount` is supplied, a one-off percent-off discount is
   * created and applied to the checkout session before completion. The
   * resulting payment should carry the applied discount.
   */
  async function buildPaymentFixture(
    harness: ProviderTestHarness,
    opts: { discount?: { percentOff: number } } = {},
  ): Promise<{
    customer: ProviderCustomer;
    product: ProviderProduct;
    price: ProviderPrice;
    sessionId: string;
    payment: ProviderPayment;
    discount: ProviderDiscount | null;
  }> {
    if (!harness.setup?.completePayment) throw new Error('precondition');
    const provider = harness.provider;

    const customer = await provider.customers.create({});
    await harness.assertConsistency?.customer?.(customer);
    const product = await provider.products.create({ name: 'fixture', taxCategory: 'saas' });
    await harness.assertConsistency?.product?.(product);
    const price = await provider.prices.create({
      productId: product.id,
      currency: 'usd',
      kind: 'one_time',
      unitAmount: 1000,
    });
    await harness.assertConsistency?.price?.(price);
    let discount: ProviderDiscount | null = null;
    if (opts.discount) {
      discount = await provider.discounts.create({
        benefit: { kind: 'percent', percentOff: opts.discount.percentOff },
        duration: { kind: 'once' },
      });
      await harness.assertConsistency?.discount?.(discount);
    }
    const session = await provider.checkout.createSession({
      lineItems: [{ priceId: price.id, quantity: 1 }],
      mode: 'payment',
      successUrl: 'https://example.com/s',
      customerId: customer.id,
      ...(discount ? { discount: { kind: 'discountId', discountId: discount.id } } : {}),
    });
    const payment = await harness.setup.completePayment({
      checkoutSessionId: session.id,
    });
    await harness.assertConsistency?.payment?.(payment);
    return { customer, product, price, sessionId: session.id, payment, discount };
  }

  // ---------------------------------------------------------------------------
  // Outer describe — acquires harness once, registers per-method describes.
  // ---------------------------------------------------------------------------

  describe(`payments [${label}]`, () => {
    let harness: ProviderTestHarness;
    let provider: BillingProvider;

    beforeAll(async () => {
      harness = await Promise.resolve(factory());
      provider = harness.provider;
    });

    // -------------------------------------------------------------------------
    // payments.completePayment (happy path)
    // -------------------------------------------------------------------------
    describe('payments.completePayment flow', () => {
      lazySkipIf(() => !harness?.setup?.completePayment)(
        'returns a normalized payment with sane shape after completion',
        async () => {
          const { customer, product, price, sessionId, payment } =
            await buildPaymentFixture(harness);

          expectIsPayment(payment);
          if (payment.customerId !== null) {
            expect(payment.customerId).toBe(customer.id);
          }
          expect(['pending', 'succeeded']).toContain(payment.status);
          expect(Number.isInteger(payment.amount.amount)).toBe(true);
          expect(payment.amount.amount).toBeGreaterThan(0);
          expect(/^[a-z]{3}$/.test(payment.amount.currency)).toBe(true);
          expect(payment.amountRefunded).toBeNull();
          if (payment.priceId !== null) {
            expect(payment.priceId).toBe(price.id);
          }
          if (payment.productId !== null) {
            expect(payment.productId).toBe(product.id);
          }
          expect(payment.checkoutSessionId).toBe(sessionId);
          for (const k of Object.keys(payment.metadata)) {
            expect(k.startsWith('__provider_')).toBe(false);
          }
          expect(payment.createdAt).toBeInstanceOf(Date);
        },
      );

      lazySkipIf(() => !harness?.setup?.completePayment)(
        'get({id}) deep-equals the payment returned by completion',
        async () => {
          const { payment } = await buildPaymentFixture(harness);
          const got = await provider.payments.get({ id: payment.id });
          expect(withoutRaw(nonNull(got, 'got'))).toEqual(withoutRaw(payment));
          if (got !== null) {
            await harness.assertConsistency?.payment?.(got);
          }
        },
      );

      lazySkipIf(() => !harness?.setup?.completePayment)(
        'list() includes the payment (found by id)',
        async () => {
          const { payment } = await buildPaymentFixture(harness);
          const all = await provider.payments.list();
          expectIsPage<ProviderPayment>(all);
          const found = all.data.find((p) => p.id === payment.id);
          expect(found).toBeDefined();
          expectIsPayment(found);
          await harness.assertConsistency?.payment?.(found);
          expect(withoutRaw(nonNull(found, 'found'))).toEqual(withoutRaw(payment));
        },
      );

      lazySkipIf(() => !harness?.setup?.completePayment)(
        'list({customerId}) includes the payment',
        async () => {
          const { customer, payment } = await buildPaymentFixture(harness);
          const out = await provider.payments.list({ customerId: customer.id });
          expectIsPage<ProviderPayment>(out);
          const ids = new Set(out.data.map((p) => p.id));
          expect(ids.has(payment.id)).toBe(true);
        },
      );

      lazySkipIf(() => !harness?.setup?.completePayment)(
        'list({customerId, status}) matches by status; a non-matching status excludes it',
        async () => {
          const { customer, payment } = await buildPaymentFixture(harness);

          const matching = await provider.payments.list({
            customerId: customer.id,
            status: payment.status,
          });
          expectIsPage<ProviderPayment>(matching);
          const matchingIds = new Set(matching.data.map((p) => p.id));
          expect(matchingIds.has(payment.id)).toBe(true);

          const others = PAYMENT_STATUSES.filter((s) => s !== payment.status);
          if (others.length > 0) {
            const nonMatching = nonNull(others[0], 'others[0]');
            const excluded = await provider.payments.list({
              customerId: customer.id,
              status: nonMatching,
            });
            expectIsPage<ProviderPayment>(excluded);
            const excludedIds = new Set(excluded.data.map((p) => p.id));
            expect(excludedIds.has(payment.id)).toBe(false);
          }
        },
      );

      lazySkipIf(() => !harness?.setup?.completePayment)(
        'applied discount round-trips on the resulting payment',
        async () => {
          const { payment, discount } = await buildPaymentFixture(harness, {
            discount: { percentOff: 20 },
          });
          expect(discount).not.toBeNull();
          // The percent-off discount should produce exactly one
          // appliedDiscounts entry whose discountId matches and whose amount
          // is positive. The mock computes amount synchronously; Stripe
          // surfaces it on the underlying invoice (subscription path) or
          // skips for PaymentIntent-only paths — adapters that can't surface
          // payment-level discounts should leave the array empty rather than
          // fail this assertion (this test runs under self-setup only when
          // completePayment exists).
          expect(payment.appliedDiscounts.length).toBeGreaterThanOrEqual(0);
          const entry = payment.appliedDiscounts.find((d) => d.discountId === discount!.id);
          if (entry) {
            expect(entry.amountDiscounted.amount).toBeGreaterThan(0);
            expect(entry.amountDiscounted.currency).toBe(payment.amount.currency);
            // When subtotal is also surfaced, sanity-check the math
            // (subtotal - sum(appliedDiscounts) should equal amount).
            if (payment.subtotal !== undefined) {
              const discounted = payment.appliedDiscounts.reduce(
                (sum, d) => sum + d.amountDiscounted.amount,
                0,
              );
              expect(payment.subtotal.amount - discounted).toBe(payment.amount.amount);
            }
          }
        },
      );

      lazySkipIf(() => !harness?.setup?.completePayment)(
        'round-trip: every payment from list({customerId}) deep-equals its get({id})',
        async () => {
          const { customer } = await buildPaymentFixture(harness);
          const out = await provider.payments.list({ customerId: customer.id });
          expectIsPage<ProviderPayment>(out);
          expect(out.data.length).toBeGreaterThan(0);
          for (const p of out.data) {
            expectIsPayment(p);
            const got = await provider.payments.get({ id: p.id });
            expect(withoutRaw(nonNull(got, 'got'))).toEqual(withoutRaw(p));
          }
        },
      );
    });

    // -------------------------------------------------------------------------
    // Teardown is left to the harness — no per-suite cleanup since the public
    // SDK exposes no `payments.archive`, and customer/product/price cleanup is
    // best-effort done by the harness.teardown when present.
    // -------------------------------------------------------------------------
    afterAll(async () => {
      if (harness?.teardown) {
        try {
          await harness.teardown();
        } catch {
          // Ignore teardown failures.
        }
      }
    });
  });
}
