import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type {
  BillingProvider,
  ProviderCustomer,
  ProviderPrice,
  ProviderProduct,
  ProviderPurchase,
} from '../../../index.js';
import { withoutRaw } from '../../equality.js';
import type { ProviderTestHarness } from '../../harness.js';
import { lazySkipIf, nonNull } from '../../skip-if.js';

/**
 * Registers the purchases self-setup conformance suite. Every test here
 * promotes a checkout session to a completed purchase via
 * `setup.completePurchase`; the entire suite is gated on that capability
 * being present on the harness.
 */
export function registerPurchasesSelfSetupSuite(
  label: string,
  factory: () => ProviderTestHarness | Promise<ProviderTestHarness>,
): void {
  // ---------------------------------------------------------------------------
  // Helpers (inlined per the task instructions — no shared util library yet).
  // ---------------------------------------------------------------------------

  function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  const PURCHASE_STATUSES = [
    'pending',
    'succeeded',
    'failed',
    'refunded',
    'partially_refunded',
  ] as const;
  const STATUS_SET = new Set<string>(PURCHASE_STATUSES);

  function expectIsPage<T>(p: unknown): asserts p is { data: T[]; nextCursor: string | null } {
    expect(typeof p === 'object' && p !== null).toBe(true);
    const rec = p as Record<string, unknown>;
    expect(Array.isArray(rec.data)).toBe(true);
    expect(rec.nextCursor === null || typeof rec.nextCursor === 'string').toBe(true);
    if (typeof rec.nextCursor === 'string') {
      expect((rec.nextCursor as string).length).toBeGreaterThan(0);
    }
  }

  function expectIsPurchase(p: unknown): asserts p is ProviderPurchase {
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
   * complete the session into a purchase. Caller is responsible for
   * confirming `harness.setup?.completePurchase` exists first.
   */
  async function buildPurchaseFixture(harness: ProviderTestHarness): Promise<{
    customer: ProviderCustomer;
    product: ProviderProduct;
    price: ProviderPrice;
    sessionId: string;
    purchase: ProviderPurchase;
  }> {
    if (!harness.setup?.completePurchase) throw new Error('precondition');
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
    const session = await provider.checkout.createSession({
      lineItems: [{ priceId: price.id, quantity: 1 }],
      successUrl: 'https://example.com/s',
      customerId: customer.id,
    });
    const purchase = await harness.setup.completePurchase({
      checkoutSessionId: session.id,
    });
    await harness.assertConsistency?.purchase?.(purchase);
    return { customer, product, price, sessionId: session.id, purchase };
  }

  // ---------------------------------------------------------------------------
  // Outer describe — acquires harness once, registers per-method describes.
  // ---------------------------------------------------------------------------

  describe(`purchases [${label}]`, () => {
    let harness: ProviderTestHarness;
    let provider: BillingProvider;

    beforeAll(async () => {
      harness = await Promise.resolve(factory());
      provider = harness.provider;
    });

    // -------------------------------------------------------------------------
    // purchases.completePurchase (happy path)
    // -------------------------------------------------------------------------
    describe('purchases.completePurchase flow', () => {
      lazySkipIf(() => !harness?.setup?.completePurchase)(
        'returns a normalized purchase with sane shape after completion',
        async () => {
          const { customer, product, price, sessionId, purchase } =
            await buildPurchaseFixture(harness);

          expectIsPurchase(purchase);
          if (purchase.customerId !== null) {
            expect(purchase.customerId).toBe(customer.id);
          }
          expect(['pending', 'succeeded']).toContain(purchase.status);
          expect(Number.isInteger(purchase.amount.amount)).toBe(true);
          expect(purchase.amount.amount).toBeGreaterThan(0);
          expect(/^[a-z]{3}$/.test(purchase.amount.currency)).toBe(true);
          expect(purchase.amountRefunded).toBeNull();
          if (purchase.priceId !== null) {
            expect(purchase.priceId).toBe(price.id);
          }
          if (purchase.productId !== null) {
            expect(purchase.productId).toBe(product.id);
          }
          expect(purchase.checkoutSessionId).toBe(sessionId);
          for (const k of Object.keys(purchase.metadata)) {
            expect(k.startsWith('__provider_')).toBe(false);
          }
          expect(purchase.createdAt).toBeInstanceOf(Date);
        },
      );

      lazySkipIf(() => !harness?.setup?.completePurchase)(
        'get({id}) deep-equals the purchase returned by completion',
        async () => {
          const { purchase } = await buildPurchaseFixture(harness);
          const got = await provider.purchases.get({ id: purchase.id });
          expect(withoutRaw(nonNull(got, 'got'))).toEqual(withoutRaw(purchase));
          if (got !== null) {
            await harness.assertConsistency?.purchase?.(got);
          }
        },
      );

      lazySkipIf(() => !harness?.setup?.completePurchase)(
        'list() includes the purchase (found by id)',
        async () => {
          const { purchase } = await buildPurchaseFixture(harness);
          const all = await provider.purchases.list();
          expectIsPage<ProviderPurchase>(all);
          const found = all.data.find((p) => p.id === purchase.id);
          expect(found).toBeDefined();
          expectIsPurchase(found);
          await harness.assertConsistency?.purchase?.(found);
          expect(withoutRaw(nonNull(found, 'found'))).toEqual(withoutRaw(purchase));
        },
      );

      lazySkipIf(() => !harness?.setup?.completePurchase)(
        'list({customerId}) includes the purchase',
        async () => {
          const { customer, purchase } = await buildPurchaseFixture(harness);
          const out = await provider.purchases.list({ customerId: customer.id });
          expectIsPage<ProviderPurchase>(out);
          const ids = new Set(out.data.map((p) => p.id));
          expect(ids.has(purchase.id)).toBe(true);
        },
      );

      lazySkipIf(() => !harness?.setup?.completePurchase)(
        'list({customerId, status}) matches by status; a non-matching status excludes it',
        async () => {
          const { customer, purchase } = await buildPurchaseFixture(harness);

          const matching = await provider.purchases.list({
            customerId: customer.id,
            status: purchase.status,
          });
          expectIsPage<ProviderPurchase>(matching);
          const matchingIds = new Set(matching.data.map((p) => p.id));
          expect(matchingIds.has(purchase.id)).toBe(true);

          const others = PURCHASE_STATUSES.filter((s) => s !== purchase.status);
          if (others.length > 0) {
            const nonMatching = nonNull(others[0], 'others[0]');
            const excluded = await provider.purchases.list({
              customerId: customer.id,
              status: nonMatching,
            });
            expectIsPage<ProviderPurchase>(excluded);
            const excludedIds = new Set(excluded.data.map((p) => p.id));
            expect(excludedIds.has(purchase.id)).toBe(false);
          }
        },
      );

      lazySkipIf(() => !harness?.setup?.completePurchase)(
        'round-trip: every purchase from list({customerId}) deep-equals its get({id})',
        async () => {
          const { customer } = await buildPurchaseFixture(harness);
          const out = await provider.purchases.list({ customerId: customer.id });
          expectIsPage<ProviderPurchase>(out);
          expect(out.data.length).toBeGreaterThan(0);
          for (const p of out.data) {
            expectIsPurchase(p);
            const got = await provider.purchases.get({ id: p.id });
            expect(withoutRaw(nonNull(got, 'got'))).toEqual(withoutRaw(p));
          }
        },
      );
    });

    // -------------------------------------------------------------------------
    // Teardown is left to the harness — no per-suite cleanup since the public
    // SDK exposes no `purchases.archive`, and customer/product/price cleanup is
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
