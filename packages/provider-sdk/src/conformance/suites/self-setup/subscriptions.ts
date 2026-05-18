import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ProviderConflictError, ProviderConstraintError } from '../../../errors/index.js';
import type { BillingProvider, ProviderSubscription } from '../../../index.js';
import type { ProviderTestHarness } from '../../harness.js';
import { lazySkipIf } from '../../skip-if.js';

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
  // Every product this suite creates as scaffolding is tracked here so the
  // afterAll can archive it. Products can't be deleted on most providers
  // (Stripe), so without this they accumulate as active residue across runs.
  // Declared at suite scope (not inside the describe) so the module-level
  // `getSubscription` helper can record into it too.
  const createdProductIds = new Set<string>();

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

    // trialEnd bidirectional invariant (cross-provider contract): non-null
    // IFF the subscription is actively trialing. Not trialing (active,
    // canceled, past_due, …) MUST be null — even for providers like Stripe
    // that keep their native trial-end populated forever; the adapter
    // normalizes it down to null. A provider that nulls trial-end after the
    // trial can't be normalized "up" to a date, so the SDK never promises
    // one post-trial. (When trialing, the precise future-window is checked
    // by the dedicated trial round-trip test below.)
    expect(rec.trialEnd === null || rec.trialEnd instanceof Date).toBe(true);
    if (rec.status === 'trialing') {
      expect(rec.trialEnd).toBeInstanceOf(Date);
      expect(Number.isFinite((rec.trialEnd as Date).getTime())).toBe(true);
    } else {
      expect(rec.trialEnd).toBeNull();
    }

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
    await harness.assertConsistency?.customer?.(customer);
    const product = await harness.provider.products.create({
      name: 'fixture',
      taxCategory: 'saas',
    });
    createdProductIds.add(product.id);
    await harness.assertConsistency?.product?.(product);
    const price = await harness.provider.prices.create({
      productId: product.id,
      currency: 'usd',
      kind: 'recurring',
      unitAmount: 999,
      interval: 'month',
    } as any);
    await harness.assertConsistency?.price?.(price);
    const sub = await harness.setup.createSubscription({
      customerId: customer.id,
      priceId: price.id,
    });
    await harness.assertConsistency?.subscription?.(sub);
    return sub;
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
      lazySkipIf(() => !harness?.setup?.createSubscription)(
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

      lazySkipIf(() => !harness?.setup?.createSubscription)(
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
      lazySkipIf(() => !harness?.setup?.createSubscription)(
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
      lazySkipIf(() => !harness?.setup?.createSubscription)(
        "when:'at_period_end' sets cancelAtPeriodEnd=true and schedules a cancel pendingChange",
        async () => {
          const sub = await getSubscription(harness);
          const out = await provider.subscriptions.cancel({
            id: sub.id,
            when: 'at_period_end',
          });
          expectIsSubscription(out);
          await harness.assertConsistency?.subscription?.(out);
          expect(out.cancelAtPeriodEnd).toBe(true);
          expect(out.pendingChange).not.toBeNull();
          expect(out.pendingChange?.kind).toBe('cancel');
          expect(out.pendingChange?.effectiveAt).toBeInstanceOf(Date);
          expect(approxEqualDate(out.pendingChange!.effectiveAt, out.currentPeriodEnd)).toBe(true);
        },
      );

      lazySkipIf(() => !harness?.setup?.createSubscription)(
        "when:'immediately' sets canceledAt, clears pendingChange, cancelAtPeriodEnd=false",
        async () => {
          const sub = await getSubscription(harness);
          const out = await provider.subscriptions.cancel({
            id: sub.id,
            when: 'immediately',
          });
          expectIsSubscription(out);
          await harness.assertConsistency?.subscription?.(out);
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
      lazySkipIf(() => !harness?.setup?.createSubscription)(
        "when:'immediately' replaces items and clears pendingChange",
        async () => {
          const sub = await getSubscription(harness);
          // Create a new price to swap to.
          const product = await provider.products.create({ name: 'swap', taxCategory: 'saas' });
          createdProductIds.add(product.id);
          await harness.assertConsistency?.product?.(product);
          const newPrice = await provider.prices.create({
            productId: product.id,
            currency: 'usd',
            kind: 'recurring',
            unitAmount: 1999,
            interval: 'month',
            quantity: { min: 1, max: 10 },
          } as any);
          await harness.assertConsistency?.price?.(newPrice);
          const out = await provider.subscriptions.change({
            id: sub.id,
            items: [{ priceId: newPrice.id, quantity: 2 }],
            when: 'immediately',
          } as any);
          expectIsSubscription(out);
          await harness.assertConsistency?.subscription?.(out);
          expect(out.pendingChange).toBeNull();
          expect(out.items.length).toBe(1);
          expect(out.items[0]?.priceId).toBe(newPrice.id);
          expect(out.items[0]?.quantity).toBe(2);
        },
      );

      lazySkipIf(() => !harness?.setup?.createSubscription)(
        "when:'at_period_end' schedules a price_change pendingChange and leaves current items unchanged",
        async () => {
          const sub = await getSubscription(harness);
          const before = await provider.subscriptions.get({ id: sub.id });
          expect(before).not.toBeNull();
          const beforeItems = (before as ProviderSubscription).items;

          const product = await provider.products.create({ name: 'swap2', taxCategory: 'saas' });
          createdProductIds.add(product.id);
          await harness.assertConsistency?.product?.(product);
          const newPrice = await provider.prices.create({
            productId: product.id,
            currency: 'usd',
            kind: 'recurring',
            unitAmount: 2999,
            interval: 'month',
            quantity: { min: 1, max: 10 },
          } as any);
          await harness.assertConsistency?.price?.(newPrice);

          const out = await provider.subscriptions.change({
            id: sub.id,
            items: [{ priceId: newPrice.id, quantity: 3 }],
            when: 'at_period_end',
          } as any);
          expectIsSubscription(out);
          await harness.assertConsistency?.subscription?.(out);
          expect(out.pendingChange).not.toBeNull();
          expect(out.pendingChange?.kind).toBe('price_change');
          expect(out.pendingChange?.effectiveAt).toBeInstanceOf(Date);
          expect(approxEqualDate(out.pendingChange!.effectiveAt, out.currentPeriodEnd)).toBe(true);
          expect(Array.isArray(out.pendingChange?.items)).toBe(true);
          expect(out.pendingChange?.items?.[0]?.priceId).toBe(newPrice.id);
          expect(out.pendingChange?.items?.[0]?.quantity).toBe(3);

          // Current items unchanged from before.
          expect(out.items.map((i) => i.priceId).sort()).toEqual(
            beforeItems.map((i) => i.priceId).sort(),
          );
        },
      );

      lazySkipIf(() => !harness?.setup?.createSubscription)(
        "succeeds with prorationBehavior:'create_prorations'",
        async () => {
          const sub = await getSubscription(harness);
          const product = await provider.products.create({
            name: 'pro-create',
            taxCategory: 'saas',
          });
          createdProductIds.add(product.id);
          await harness.assertConsistency?.product?.(product);
          const newPrice = await provider.prices.create({
            productId: product.id,
            currency: 'usd',
            kind: 'recurring',
            unitAmount: 1499,
            interval: 'month',
          } as any);
          await harness.assertConsistency?.price?.(newPrice);
          const out = await provider.subscriptions.change({
            id: sub.id,
            items: [{ priceId: newPrice.id }],
            prorationBehavior: 'create_prorations',
          } as any);
          expectIsSubscription(out);
          await harness.assertConsistency?.subscription?.(out);
        },
      );

      lazySkipIf(() => !harness?.setup?.createSubscription)(
        "succeeds with prorationBehavior:'none'",
        async () => {
          const sub = await getSubscription(harness);
          const product = await provider.products.create({
            name: 'pro-none',
            taxCategory: 'saas',
          });
          createdProductIds.add(product.id);
          await harness.assertConsistency?.product?.(product);
          const newPrice = await provider.prices.create({
            productId: product.id,
            currency: 'usd',
            kind: 'recurring',
            unitAmount: 1499,
            interval: 'month',
          } as any);
          await harness.assertConsistency?.price?.(newPrice);
          const out = await provider.subscriptions.change({
            id: sub.id,
            items: [{ priceId: newPrice.id }],
            prorationBehavior: 'none',
          } as any);
          expectIsSubscription(out);
          await harness.assertConsistency?.subscription?.(out);
        },
      );
    });

    // -------------------------------------------------------------------------
    // subscriptions.cancelScheduledChange (happy path)
    // -------------------------------------------------------------------------
    describe('subscriptions.cancelScheduledChange', () => {
      lazySkipIf(() => !harness?.setup?.createSubscription)(
        'clears a scheduled price_change pendingChange',
        async () => {
          const sub = await getSubscription(harness);
          const product = await provider.products.create({
            name: 'sched-price',
            taxCategory: 'saas',
          });
          createdProductIds.add(product.id);
          await harness.assertConsistency?.product?.(product);
          const newPrice = await provider.prices.create({
            productId: product.id,
            currency: 'usd',
            kind: 'recurring',
            unitAmount: 1299,
            interval: 'month',
          } as any);
          await harness.assertConsistency?.price?.(newPrice);
          const scheduled = await provider.subscriptions.change({
            id: sub.id,
            items: [{ priceId: newPrice.id }],
            when: 'at_period_end',
          } as any);
          await harness.assertConsistency?.subscription?.(scheduled);
          expect(scheduled.pendingChange).not.toBeNull();
          expect(scheduled.pendingChange?.kind).toBe('price_change');

          const out = await provider.subscriptions.cancelScheduledChange({ id: sub.id });
          expectIsSubscription(out);
          await harness.assertConsistency?.subscription?.(out);
          expect(out.pendingChange).toBeNull();
        },
      );

      lazySkipIf(() => !harness?.setup?.createSubscription)(
        'clears a scheduled cancel (cancelAtPeriodEnd flips false, pendingChange null)',
        async () => {
          const sub = await getSubscription(harness);
          const scheduled = await provider.subscriptions.cancel({
            id: sub.id,
            when: 'at_period_end',
          });
          await harness.assertConsistency?.subscription?.(scheduled);
          expect(scheduled.cancelAtPeriodEnd).toBe(true);
          expect(scheduled.pendingChange).not.toBeNull();

          const out = await provider.subscriptions.cancelScheduledChange({ id: sub.id });
          expectIsSubscription(out);
          await harness.assertConsistency?.subscription?.(out);
          expect(out.pendingChange).toBeNull();
          expect(out.cancelAtPeriodEnd).toBe(false);
          expect(out.canceledAt).toBeNull();
        },
      );

      lazySkipIf(() => !harness?.setup?.createSubscription)(
        'on a subscription with no pending change: success (no-op) OR 409/422',
        async () => {
          const sub = await getSubscription(harness);
          expect(sub.pendingChange).toBeNull();

          const result = await provider.subscriptions.cancelScheduledChange({ id: sub.id }).then(
            (value) => ({ ok: true as const, value }),
            (err: unknown) => ({ ok: false as const, err }),
          );

          if (result.ok) {
            expectIsSubscription(result.value);
            await harness.assertConsistency?.subscription?.(result.value);
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
    // Trial round-trip (uses setup.createSubscription({ trial }))
    // -------------------------------------------------------------------------
    describe('subscriptions trial', () => {
      lazySkipIf(() => !harness?.setup?.createSubscription)(
        'createSubscription({ trial: { count, unit: "day" } }) returns a trialing subscription with trialEnd set',
        async () => {
          if (!harness.setup?.createSubscription) return; // unreachable per skipIf
          const customer = await provider.customers.create({});
          await harness.assertConsistency?.customer?.(customer);
          const product = await provider.products.create({
            name: 'trial-fixture',
            taxCategory: 'saas',
          });
          createdProductIds.add(product.id);
          await harness.assertConsistency?.product?.(product);
          const price = await provider.prices.create({
            productId: product.id,
            currency: 'usd',
            kind: 'recurring',
            unitAmount: 999,
            interval: 'month',
          } as any);
          await harness.assertConsistency?.price?.(price);

          const before = Date.now();
          const sub = await harness.setup.createSubscription({
            customerId: customer.id,
            priceId: price.id,
            trial: { count: 14, unit: 'day' },
          });
          const after = Date.now();
          expectIsSubscription(sub);
          await harness.assertConsistency?.subscription?.(sub);

          expect(sub.status).toBe('trialing');
          expect(sub.trialEnd).toBeInstanceOf(Date);
          // trialEnd should land roughly 14 days after the moment the
          // subscription was created. Use a wide tolerance (±2 days) to
          // accommodate clock skew and provider rounding (Stripe's
          // `trial_period_days` rounds to whole days).
          const expectedMin = before + 14 * 24 * 60 * 60 * 1000 - 2 * 24 * 60 * 60 * 1000;
          const expectedMax = after + 14 * 24 * 60 * 60 * 1000 + 2 * 24 * 60 * 60 * 1000;
          const trialEndMs = (sub.trialEnd as Date).getTime();
          expect(trialEndMs).toBeGreaterThanOrEqual(expectedMin);
          expect(trialEndMs).toBeLessThanOrEqual(expectedMax);
        },
      );
    });

    // -------------------------------------------------------------------------
    // Teardown — archive every scaffolding product this suite created. Try the
    // harness hard-delete hook first (Stripe drops price-free products); fall
    // through to the contract soft-delete so products that can't be deleted
    // (they have an attached price) are at least left inactive, not active
    // residue accumulating across runs.
    // -------------------------------------------------------------------------
    afterAll(async () => {
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
