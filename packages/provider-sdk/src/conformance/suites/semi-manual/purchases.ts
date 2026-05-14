import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { BillingProvider, ProviderPurchase } from '../../../index.js';
import type { ProviderTestHarness } from '../../harness.js';

/**
 * Registers the purchases semi-manual conformance suite. The single test
 * drives the checkout fixture, asks the developer to complete payment via
 * `harness.prompt`, then polls `purchases.list({customerId})` every 1s for
 * up to 60s until a matching purchase appears.
 *
 * The whole suite is gated on `harness.prompt`; the outer
 * `describe.skipIf(!isInteractiveMode())` in `semi-manual/index.ts` further
 * skips everything when `INTERACTIVE` is not truthy.
 */
export function registerPurchasesSemiManualSuite(
  label: string,
  factory: () => ProviderTestHarness | Promise<ProviderTestHarness>,
): void {
  // ---------------------------------------------------------------------------
  // Helpers (inlined per the task instructions — no shared util library yet).
  // ---------------------------------------------------------------------------

  function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  const PURCHASE_STATUSES = new Set([
    'pending',
    'succeeded',
    'failed',
    'refunded',
    'partially_refunded',
  ]);

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
    expect(PURCHASE_STATUSES.has(rec.status as string)).toBe(true);

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
    expect(
      rec.checkoutSessionId === null || typeof rec.checkoutSessionId === 'string',
    ).toBe(true);

    expect(isPlainObject(rec.metadata)).toBe(true);
    for (const [k, v] of Object.entries(rec.metadata as Record<string, unknown>)) {
      expect(typeof v).toBe('string');
      expect(k.startsWith('__provider_')).toBe(false);
    }

    expect(rec.createdAt).toBeInstanceOf(Date);
    expect(Number.isFinite((rec.createdAt as Date).getTime())).toBe(true);
  }

  const POLL_INTERVAL_MS = 1000;
  const POLL_TIMEOUT_MS = 60_000;

  async function sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Poll `purchases.list({customerId})` until we observe a purchase whose
   * `checkoutSessionId` matches `sessionId`. Times out after
   * `POLL_TIMEOUT_MS`.
   */
  async function pollForPurchase(
    provider: BillingProvider,
    customerId: string,
    sessionId: string,
  ): Promise<ProviderPurchase> {
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    let firstObservation = true;
    while (Date.now() < deadline) {
      const out = await provider.purchases.list({ customerId });
      if (firstObservation) {
        expectIsPage<ProviderPurchase>(out);
        firstObservation = false;
      }
      const match = out.data.find((p) => p.checkoutSessionId === sessionId);
      if (match) return match;
      await sleep(POLL_INTERVAL_MS);
    }
    throw new Error(`Timeout waiting for purchase from session ${sessionId}`);
  }

  // ---------------------------------------------------------------------------
  // Outer describe — acquires harness once, gates on `harness.prompt`.
  // ---------------------------------------------------------------------------

  describe(`purchases [${label}]`, () => {
    let harness: ProviderTestHarness;
    let provider: BillingProvider;

    beforeAll(async () => {
      harness = await Promise.resolve(factory());
      provider = harness.provider;
    });

    describe('purchases manual-completion flow', () => {
      it.skipIf(!harness?.prompt)(
        'observes a purchase via polling after manual checkout completion',
        async () => {
          // Build fixture.
          const customer = await provider.customers.create({});
          const product = await provider.products.create({
            name: 'fixture',
            taxCategory: 'saas',
          });
          const price = await provider.prices.create({
            productId: product.id,
            currency: 'usd',
            kind: 'one_time',
            unitAmount: 1000,
          });
          const session = await provider.checkout.createSession({
            lineItems: [{ priceId: price.id, quantity: 1 }],
            successUrl: 'https://example.com/s',
            customerId: customer.id,
          });

          // The checkout session's presentation field carries the provider-
          // specific data the developer needs (hosted URL, embedded token,
          // etc.). It is opaque to conformance, so we dump it in the prompt
          // and let the dev pull out whatever they need.
          await harness.prompt!(
            [
              `Complete checkout for session ${session.id} with a test card.`,
              `Presentation payload:`,
              JSON.stringify(session.presentation, null, 2),
              `Press Enter when done.`,
            ].join('\n'),
          );

          const purchase = await pollForPurchase(provider, customer.id, session.id);

          // Shape invariants.
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
          expect(purchase.checkoutSessionId).toBe(session.id);
          for (const k of Object.keys(purchase.metadata)) {
            expect(k.startsWith('__provider_')).toBe(false);
          }
          expect(purchase.createdAt).toBeInstanceOf(Date);

          // get round-trip.
          const got = await provider.purchases.get({ id: purchase.id });
          expect(got).toEqual(purchase);

          // list round-trip: every purchase under this customer deep-equals get.
          const out = await provider.purchases.list({ customerId: customer.id });
          expectIsPage<ProviderPurchase>(out);
          for (const p of out.data) {
            expectIsPurchase(p);
            const single = await provider.purchases.get({ id: p.id });
            expect(single).toEqual(p);
          }
        },
        POLL_TIMEOUT_MS + 30_000,
      );
    });

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
