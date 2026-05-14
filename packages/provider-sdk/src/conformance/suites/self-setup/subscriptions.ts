import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { BillingProvider, ProviderSubscription } from '../../../index.js';
import {
  ProviderConflictError,
  ProviderConstraintError,
} from '../../../errors/index.js';
import type { ProviderTestHarness } from '../../harness.js';

/**
 * Registers the subscriptions self-setup conformance suite. Every test here
 * needs a real, live subscription to exercise; each is gated on the harness
 * exposing `setup.createSubscription`. Adapters whose providers cannot create
 * a subscription via the public SDK alone (Paddle, for instance) will skip
 * the entire suite.
 */
export function registerSubscriptionsSelfSetupSuite(
  label: string,
  factory: () => ProviderTestHarness | Promise<ProviderTestHarness>,
): void {
  // ---------------------------------------------------------------------------
  // Helpers (inlined per the task instructions — no shared util library yet).
  // ---------------------------------------------------------------------------

  function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  function isPositiveInt(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value > 0;
  }

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

    expect([
      'trialing',
      'active',
      'past_due',
      'unpaid',
      'canceled',
      'incomplete',
      'incomplete_expired',
    ]).toContain(rec.status);

    expect(Array.isArray(rec.items)).toBe(true);
    const items = rec.items as unknown[];
    expect(items.length).toBeGreaterThanOrEqual(1);
    for (const item of items) {
      expect(isPlainObject(item)).toBe(true);
      const i = item as Record<string, unknown>;
      expect(typeof i.id).toBe('string');
      expect((i.id as string).length).toBeGreaterThan(0);
      expect(typeof i.priceId).toBe('string');
      expect((i.priceId as string).length).toBeGreaterThan(0);
      expect(isPositiveInt(i.quantity)).toBe(true);
    }

    expect(rec.currentPeriodStart).toBeInstanceOf(Date);
    expect(rec.currentPeriodEnd).toBeInstanceOf(Date);
    expect(Number.isFinite((rec.currentPeriodStart as Date).getTime())).toBe(true);
    expect(Number.isFinite((rec.currentPeriodEnd as Date).getTime())).toBe(true);

    expect(typeof rec.cancelAtPeriodEnd).toBe('boolean');
    expect(rec.canceledAt === null || rec.canceledAt instanceof Date).toBe(true);

    expect(rec.pendingChange === null || isPlainObject(rec.pendingChange)).toBe(true);
    if (rec.pendingChange !== null && isPlainObject(rec.pendingChange)) {
      const pc = rec.pendingChange as Record<string, unknown>;
      expect(pc.kind === 'price_change' || pc.kind === 'cancel').toBe(true);
      expect(pc.effectiveAt).toBeInstanceOf(Date);
      if (pc.items !== undefined) {
        expect(Array.isArray(pc.items)).toBe(true);
        for (const item of pc.items as unknown[]) {
          expect(isPlainObject(item)).toBe(true);
          const i = item as Record<string, unknown>;
          expect(typeof i.priceId).toBe('string');
          expect(isPositiveInt(i.quantity)).toBe(true);
        }
      }
    }

    expect(isPlainObject(rec.metadata)).toBe(true);
    for (const [k, v] of Object.entries(rec.metadata as Record<string, unknown>)) {
      expect(typeof v).toBe('string');
      expect(k.startsWith('__provider_')).toBe(false);
    }

    expect(rec.createdAt).toBeInstanceOf(Date);
    expect(Number.isFinite((rec.createdAt as Date).getTime())).toBe(true);
  }

  /**
   * Create a fresh subscription. Resolves to the new ProviderSubscription.
   * Caller must have already verified `harness.setup?.createSubscription`.
   */
  async function getSubscription(harness: ProviderTestHarness): Promise<ProviderSubscription> {
    if (!harness.setup?.createSubscription) throw new Error('precondition');
    const customer = await harness.provider.customers.create({});
    const product = await harness.provider.products.create({ name: 'fixture' });
    const price = await harness.provider.prices.create({
      productId: product.id,
      currency: 'usd',
      kind: 'recurring',
      unitAmount: 999,
      interval: 'month',
    } as any);
    return harness.setup.createSubscription({
      customerId: customer.id,
      priceId: price.id,
    });
  }

  function approxEqualDate(a: Date, b: Date, toleranceMs = 5 * 60 * 1000): boolean {
    return Math.abs(a.getTime() - b.getTime()) <= toleranceMs;
  }

  // ---------------------------------------------------------------------------
  // Outer describe — acquires harness once, registers per-method describes.
  // ---------------------------------------------------------------------------

  describe(`subscriptions [${label}]`, () => {
    let harness: ProviderTestHarness;
    let provider: BillingProvider;

    beforeAll(async () => {
      harness = await Promise.resolve(factory());
      provider = harness.provider;
    });

    // -------------------------------------------------------------------------
    // subscriptions.list (happy path)
    // -------------------------------------------------------------------------
    describe('subscriptions.list', () => {
      it.skipIf(!harness?.setup?.createSubscription)(
        'returns the active subscription for the owning customer',
        async () => {
          const sub = await getSubscription(harness);
          expectIsSubscription(sub);
          const out = await provider.subscriptions.list({ customerId: sub.customerId });
          expectIsPage<ProviderSubscription>(out);
          for (const s of out.data) expectIsSubscription(s);
          expect(out.data.some((s) => s.id === sub.id)).toBe(true);
        },
      );

      it.skipIf(!harness?.setup?.createSubscription)(
        'filters by status correctly',
        async () => {
          const sub = await getSubscription(harness);
          const out = await provider.subscriptions.list({
            customerId: sub.customerId,
            status: 'active',
          });
          expectIsPage<ProviderSubscription>(out);
          for (const s of out.data) {
            expectIsSubscription(s);
            expect(s.status).toBe('active');
          }
        },
      );
    });

    // -------------------------------------------------------------------------
    // subscriptions.get (happy path)
    // -------------------------------------------------------------------------
    describe('subscriptions.get', () => {
      it.skipIf(!harness?.setup?.createSubscription)(
        'returns the full ProviderSubscription for an existing id',
        async () => {
          const sub = await getSubscription(harness);
          const got = await provider.subscriptions.get({ id: sub.id });
          expect(got).not.toBeNull();
          expectIsSubscription(got);
          expect((got as ProviderSubscription).id).toBe(sub.id);
        },
      );
    });

    // -------------------------------------------------------------------------
    // subscriptions.cancel (happy path)
    // -------------------------------------------------------------------------
    describe('subscriptions.cancel', () => {
      it.skipIf(!harness?.setup?.createSubscription)(
        "when:'at_period_end' sets cancelAtPeriodEnd=true and schedules a cancel pendingChange",
        async () => {
          const sub = await getSubscription(harness);
          const out = await provider.subscriptions.cancel({
            id: sub.id,
            when: 'at_period_end',
          });
          expectIsSubscription(out);
          expect(out.cancelAtPeriodEnd).toBe(true);
          expect(out.pendingChange).not.toBeNull();
          expect(out.pendingChange?.kind).toBe('cancel');
          expect(out.pendingChange?.effectiveAt).toBeInstanceOf(Date);
          expect(
            approxEqualDate(
              out.pendingChange!.effectiveAt,
              out.currentPeriodEnd,
            ),
          ).toBe(true);
        },
      );

      it.skipIf(!harness?.setup?.createSubscription)(
        "when:'immediately' sets canceledAt, clears pendingChange, cancelAtPeriodEnd=false",
        async () => {
          const sub = await getSubscription(harness);
          const out = await provider.subscriptions.cancel({
            id: sub.id,
            when: 'immediately',
          });
          expectIsSubscription(out);
          expect(out.canceledAt).toBeInstanceOf(Date);
          expect(out.pendingChange).toBeNull();
          expect(out.cancelAtPeriodEnd).toBe(false);
        },
      );
    });

    // -------------------------------------------------------------------------
    // subscriptions.change (happy path)
    // -------------------------------------------------------------------------
    describe('subscriptions.change', () => {
      it.skipIf(!harness?.setup?.createSubscription)(
        "when:'immediately' replaces items and clears pendingChange",
        async () => {
          const sub = await getSubscription(harness);
          // Create a new price to swap to.
          const product = await provider.products.create({ name: 'swap' });
          const newPrice = await provider.prices.create({
            productId: product.id,
            currency: 'usd',
            kind: 'recurring',
            unitAmount: 1999,
            interval: 'month',
          } as any);
          const out = await provider.subscriptions.change({
            id: sub.id,
            items: [{ priceId: newPrice.id, quantity: 2 }],
            when: 'immediately',
          } as any);
          expectIsSubscription(out);
          expect(out.pendingChange).toBeNull();
          expect(out.items.length).toBe(1);
          expect(out.items[0]?.priceId).toBe(newPrice.id);
          expect(out.items[0]?.quantity).toBe(2);
        },
      );

      it.skipIf(!harness?.setup?.createSubscription)(
        "when:'at_period_end' schedules a price_change pendingChange and leaves current items unchanged",
        async () => {
          const sub = await getSubscription(harness);
          const before = await provider.subscriptions.get({ id: sub.id });
          expect(before).not.toBeNull();
          const beforeItems = (before as ProviderSubscription).items;

          const product = await provider.products.create({ name: 'swap2' });
          const newPrice = await provider.prices.create({
            productId: product.id,
            currency: 'usd',
            kind: 'recurring',
            unitAmount: 2999,
            interval: 'month',
          } as any);

          const out = await provider.subscriptions.change({
            id: sub.id,
            items: [{ priceId: newPrice.id, quantity: 3 }],
            when: 'at_period_end',
          } as any);
          expectIsSubscription(out);
          expect(out.pendingChange).not.toBeNull();
          expect(out.pendingChange?.kind).toBe('price_change');
          expect(out.pendingChange?.effectiveAt).toBeInstanceOf(Date);
          expect(
            approxEqualDate(
              out.pendingChange!.effectiveAt,
              out.currentPeriodEnd,
            ),
          ).toBe(true);
          expect(Array.isArray(out.pendingChange?.items)).toBe(true);
          expect(out.pendingChange?.items?.[0]?.priceId).toBe(newPrice.id);
          expect(out.pendingChange?.items?.[0]?.quantity).toBe(3);

          // Current items unchanged from before.
          expect(out.items.map((i) => i.priceId).sort()).toEqual(
            beforeItems.map((i) => i.priceId).sort(),
          );
        },
      );

      it.skipIf(!harness?.setup?.createSubscription)(
        "succeeds with prorationBehavior:'create_prorations'",
        async () => {
          const sub = await getSubscription(harness);
          const product = await provider.products.create({ name: 'pro-create' });
          const newPrice = await provider.prices.create({
            productId: product.id,
            currency: 'usd',
            kind: 'recurring',
            unitAmount: 1499,
            interval: 'month',
          } as any);
          const out = await provider.subscriptions.change({
            id: sub.id,
            items: [{ priceId: newPrice.id }],
            prorationBehavior: 'create_prorations',
          } as any);
          expectIsSubscription(out);
        },
      );

      it.skipIf(!harness?.setup?.createSubscription)(
        "succeeds with prorationBehavior:'none'",
        async () => {
          const sub = await getSubscription(harness);
          const product = await provider.products.create({ name: 'pro-none' });
          const newPrice = await provider.prices.create({
            productId: product.id,
            currency: 'usd',
            kind: 'recurring',
            unitAmount: 1499,
            interval: 'month',
          } as any);
          const out = await provider.subscriptions.change({
            id: sub.id,
            items: [{ priceId: newPrice.id }],
            prorationBehavior: 'none',
          } as any);
          expectIsSubscription(out);
        },
      );
    });

    // -------------------------------------------------------------------------
    // subscriptions.cancelScheduledChange (happy path)
    // -------------------------------------------------------------------------
    describe('subscriptions.cancelScheduledChange', () => {
      it.skipIf(!harness?.setup?.createSubscription)(
        'clears a scheduled price_change pendingChange',
        async () => {
          const sub = await getSubscription(harness);
          const product = await provider.products.create({ name: 'sched-price' });
          const newPrice = await provider.prices.create({
            productId: product.id,
            currency: 'usd',
            kind: 'recurring',
            unitAmount: 1299,
            interval: 'month',
          } as any);
          const scheduled = await provider.subscriptions.change({
            id: sub.id,
            items: [{ priceId: newPrice.id }],
            when: 'at_period_end',
          } as any);
          expect(scheduled.pendingChange).not.toBeNull();
          expect(scheduled.pendingChange?.kind).toBe('price_change');

          const out = await provider.subscriptions.cancelScheduledChange({ id: sub.id });
          expectIsSubscription(out);
          expect(out.pendingChange).toBeNull();
        },
      );

      it.skipIf(!harness?.setup?.createSubscription)(
        'clears a scheduled cancel (cancelAtPeriodEnd flips false, pendingChange null)',
        async () => {
          const sub = await getSubscription(harness);
          const scheduled = await provider.subscriptions.cancel({
            id: sub.id,
            when: 'at_period_end',
          });
          expect(scheduled.cancelAtPeriodEnd).toBe(true);
          expect(scheduled.pendingChange).not.toBeNull();

          const out = await provider.subscriptions.cancelScheduledChange({ id: sub.id });
          expectIsSubscription(out);
          expect(out.pendingChange).toBeNull();
          expect(out.cancelAtPeriodEnd).toBe(false);
          expect(out.canceledAt).toBeNull();
        },
      );

      it.skipIf(!harness?.setup?.createSubscription)(
        'on a subscription with no pending change: success (no-op) OR 409/422',
        async () => {
          const sub = await getSubscription(harness);
          expect(sub.pendingChange).toBeNull();

          const result = await provider.subscriptions
            .cancelScheduledChange({ id: sub.id })
            .then(
              (value) => ({ ok: true as const, value }),
              (err: unknown) => ({ ok: false as const, err }),
            );

          if (result.ok) {
            expectIsSubscription(result.value);
            expect(result.value.pendingChange).toBeNull();
          } else {
            const err = result.err;
            const isAllowed =
              err instanceof ProviderConflictError || err instanceof ProviderConstraintError;
            expect(isAllowed).toBe(true);
            const status = (err as ProviderConflictError | ProviderConstraintError).status;
            expect(status === 409 || status === 422).toBe(true);
          }
        },
      );
    });

    // -------------------------------------------------------------------------
    // Teardown.
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
