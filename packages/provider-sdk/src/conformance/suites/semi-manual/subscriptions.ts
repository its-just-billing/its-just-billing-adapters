import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { BillingProvider, ProviderSubscription } from '../../../index.js';
import { createConformanceCustomer } from '../../customer-fixture.js';
import { withoutRaw } from '../../equality.js';
import type { ProviderTestHarness } from '../../harness.js';
import { awaitManualStep } from '../../prompts.js';
import { lazySkipIf } from '../../skip-if.js';

/**
 * Registers the subscriptions semi-manual conformance suite. A subscription
 * is the one resource the public SDK can't bootstrap on its own (it needs a
 * completed checkout/payment). The automated suite therefore only covers the
 * no-real-subscription paths, and the fixture suite needs a hand-provisioned,
 * pinned subscription. This suite closes that gap: it drives a
 * `mode:'subscription'` checkout, asks the developer to complete it via
 * `awaitManualStep` (press O to open), polls until the real subscription
 * appears, then exercises the lifecycle contract against it — shape +
 * consistency + get/list round-trip, a reversible immediate `change()` and
 * change-back, and a `cancel(at_period_end)` → `cancelScheduledChange`
 * restore. The created subscription is immediately canceled in `afterAll` so
 * no recurring sandbox subscription lingers.
 *
 * Gated on `harness.prompt`; the outer `describe.skipIf(!isInteractiveMode())`
 * in `semi-manual/index.ts` further skips everything unless `INTERACTIVE`.
 */
export function registerSubscriptionsSemiManualSuite(
  label: string,
  factory: () => ProviderTestHarness | Promise<ProviderTestHarness>,
): void {
  // ---------------------------------------------------------------------------
  // Helpers (inlined per the task instructions — no shared util library yet).
  // ---------------------------------------------------------------------------

  function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  const SUBSCRIPTION_STATUSES = new Set([
    'trialing',
    'active',
    'past_due',
    'unpaid',
    'canceled',
    'incomplete',
    'incomplete_expired',
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

  function expectIsSubscription(s: unknown): asserts s is ProviderSubscription {
    expect(isPlainObject(s)).toBe(true);
    const rec = s as Record<string, unknown>;

    expect(typeof rec.id).toBe('string');
    expect((rec.id as string).length).toBeGreaterThan(0);
    expect(typeof rec.customerId).toBe('string');
    expect((rec.customerId as string).length).toBeGreaterThan(0);

    expect(typeof rec.status).toBe('string');
    expect(SUBSCRIPTION_STATUSES.has(rec.status as string)).toBe(true);

    expect(Array.isArray(rec.items)).toBe(true);
    const items = rec.items as unknown[];
    expect(items.length).toBeGreaterThanOrEqual(1);
    for (const it of items) {
      expect(isPlainObject(it)).toBe(true);
      const item = it as Record<string, unknown>;
      expect(typeof item.id).toBe('string');
      expect((item.id as string).length).toBeGreaterThan(0);
      expect(typeof item.priceId).toBe('string');
      expect((item.priceId as string).length).toBeGreaterThan(0);
      expect(typeof item.quantity).toBe('number');
      expect(Number.isInteger(item.quantity)).toBe(true);
      expect((item.quantity as number) > 0).toBe(true);
    }

    expect(rec.currentPeriodStart).toBeInstanceOf(Date);
    expect(rec.currentPeriodEnd).toBeInstanceOf(Date);
    expect(rec.trialEnd === null || rec.trialEnd instanceof Date).toBe(true);
    expect(typeof rec.cancelAtPeriodEnd).toBe('boolean');
    expect(rec.canceledAt === null || rec.canceledAt instanceof Date).toBe(true);

    if (rec.pendingChange !== null) {
      expect(isPlainObject(rec.pendingChange)).toBe(true);
      const pc = rec.pendingChange as Record<string, unknown>;
      expect(['price_change', 'cancel']).toContain(pc.kind);
      expect(pc.effectiveAt).toBeInstanceOf(Date);
    }

    expect(isPlainObject(rec.metadata)).toBe(true);
    for (const k of Object.keys(rec.metadata as Record<string, unknown>)) {
      expect(k.startsWith('__provider_')).toBe(false);
    }
    expect(rec.createdAt).toBeInstanceOf(Date);
  }

  const POLL_INTERVAL_MS = 2000;
  const POLL_TIMEOUT_MS = 120_000;

  async function sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Poll `subscriptions.list({customerId})` until a subscription in a
   * started state (`active` or `trialing`) appears. Times out after
   * `POLL_TIMEOUT_MS`.
   */
  async function pollForSubscription(
    provider: BillingProvider,
    customerId: string,
  ): Promise<ProviderSubscription> {
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    let firstObservation = true;
    while (Date.now() < deadline) {
      const out = await provider.subscriptions.list({ customerId });
      if (firstObservation) {
        expectIsPage<ProviderSubscription>(out);
        firstObservation = false;
      }
      const match = out.data.find((s) => s.status === 'active' || s.status === 'trialing');
      if (match) return match;
      await sleep(POLL_INTERVAL_MS);
    }
    throw new Error(`Timeout waiting for a subscription for customer ${customerId}`);
  }

  // ---------------------------------------------------------------------------
  // Outer describe — acquires harness once, gates on `harness.prompt`.
  // ---------------------------------------------------------------------------

  describe(`subscriptions [${label}]`, () => {
    let harness: ProviderTestHarness;
    let provider: BillingProvider;
    const createdProductIds = new Set<string>();
    // Subscriptions created here must be force-canceled in afterAll so a
    // recurring sandbox subscription doesn't keep billing across runs.
    const createdSubscriptionIds = new Set<string>();

    beforeAll(async () => {
      harness = await Promise.resolve(factory());
      provider = harness.provider;
    });

    describe('subscriptions manual-completion flow', () => {
      lazySkipIf(() => !harness?.prompt)(
        'manages a subscription created via manual checkout completion',
        async () => {
          // Build fixture: a recurring price with an adjustable quantity
          // window so the change()/change-back step has room to move.
          const customer = await createConformanceCustomer(provider);
          await harness.assertConsistency?.customer?.(customer);
          const product = await provider.products.create({
            name: 'fixture-sub',
            taxCategory: 'saas',
          });
          createdProductIds.add(product.id);
          await harness.assertConsistency?.product?.(product);
          const price = await provider.prices.create({
            productId: product.id,
            currency: 'usd',
            kind: 'recurring',
            unitAmount: 1000,
            interval: 'month',
            intervalCount: 1,
            quantity: { min: 1, max: 5 },
          } as Parameters<BillingProvider['prices']['create']>[0]);
          await harness.assertConsistency?.price?.(price);

          const session = await provider.checkout.createSession({
            lineItems: [{ priceId: price.id, quantity: 1 }],
            mode: 'subscription',
            successUrl: 'https://example.com/s',
            customerId: customer.id,
          });

          const checkoutUrl = harness.checkoutUrl?.(session.presentation) ?? null;
          await awaitManualStep(
            [
              `Complete the SUBSCRIPTION checkout for session ${session.id} with a test card.`,
              'Presentation payload:',
              JSON.stringify(session.presentation, null, 2),
            ].join('\n'),
            checkoutUrl ? { openUrl: checkoutUrl } : undefined,
          );

          const sub = await pollForSubscription(provider, customer.id);
          createdSubscriptionIds.add(sub.id);

          // Shape + consistency.
          expectIsSubscription(sub);
          await harness.assertConsistency?.subscription?.(sub);
          expect(sub.customerId).toBe(customer.id);
          expect(sub.items.some((i) => i.priceId === price.id)).toBe(true);

          // get round-trip: the single read deep-equals the polled entry on
          // the normalized contract. `raw` is the provider escape hatch and
          // is excluded — two independent reads can legitimately differ there
          // (Paddle mints a fresh signed token in `raw.managementUrls` per
          // request); every normalized field must still agree.
          const got = await provider.subscriptions.get({ id: sub.id });
          expect(got).not.toBeNull();
          expectIsSubscription(got as ProviderSubscription);
          expect(withoutRaw(got as ProviderSubscription)).toEqual(withoutRaw(sub));

          // list round-trip: the subscription is present and self-consistent.
          const listed = await provider.subscriptions.list({ customerId: customer.id });
          expectIsPage<ProviderSubscription>(listed);
          const inList = listed.data.find((s) => s.id === sub.id);
          expect(inList).toBeDefined();
          const reread = await provider.subscriptions.get({ id: sub.id });
          expect(withoutRaw(reread as ProviderSubscription)).toEqual(
            withoutRaw(inList as ProviderSubscription),
          );

          // Reversible immediate change(): quantity 1 → 2 → 1. Mutating a
          // live paid subscription prorates on the sandbox card (accepted).
          const changed = await provider.subscriptions.change({
            id: sub.id,
            items: [{ priceId: price.id, quantity: 2 }],
            when: 'immediately',
            prorationBehavior: 'create_prorations',
          });
          expectIsSubscription(changed);
          await harness.assertConsistency?.subscription?.(changed);
          expect(changed.items.find((i) => i.priceId === price.id)?.quantity).toBe(2);

          const reverted = await provider.subscriptions.change({
            id: sub.id,
            items: [{ priceId: price.id, quantity: 1 }],
            when: 'immediately',
            prorationBehavior: 'create_prorations',
          });
          expectIsSubscription(reverted);
          await harness.assertConsistency?.subscription?.(reverted);
          expect(reverted.items.find((i) => i.priceId === price.id)?.quantity).toBe(1);

          // Reversible deferred cancel: schedule at period end, then clear it
          // and confirm the subscription is back to a clean running state.
          const scheduled = await provider.subscriptions.cancel({
            id: sub.id,
            when: 'at_period_end',
          });
          expectIsSubscription(scheduled);
          await harness.assertConsistency?.subscription?.(scheduled);
          expect(
            scheduled.cancelAtPeriodEnd === true || scheduled.pendingChange?.kind === 'cancel',
          ).toBe(true);

          const restored = await provider.subscriptions.cancelScheduledChange({ id: sub.id });
          expectIsSubscription(restored);
          await harness.assertConsistency?.subscription?.(restored);
          expect(restored.cancelAtPeriodEnd).toBe(false);
          expect(restored.pendingChange).toBeNull();
          expect(['active', 'trialing']).toContain(restored.status);
        },
        // Human-paced (fixture + hosted checkout + poll + several mutations).
        // Only ever runs under INTERACTIVE; a generous ceiling beats aborting
        // mid-payment.
        20 * 60_000,
      );
    });

    afterAll(async () => {
      // Force-cancel created subscriptions so no recurring sandbox sub bills
      // on future runs; then archive scaffolding products.
      for (const id of createdSubscriptionIds) {
        try {
          await provider.subscriptions.cancel({ id, when: 'immediately' });
        } catch {
          // Best-effort — the subscription may already be canceled.
        }
      }
      for (const id of createdProductIds) {
        try {
          await harness?.cleanupResource?.('product', id);
        } catch {
          // Ignore hard-delete failures — soft-delete below is the fallback.
        }
        try {
          await provider.products.deactivate({ id });
        } catch {
          // Ignore cleanup failures.
        }
      }
    });
  });
}
