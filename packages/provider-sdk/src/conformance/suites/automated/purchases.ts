import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { BillingProvider, ProviderPurchase } from '../../../index.js';
import { ProviderValidationError } from '../../../errors/index.js';
import type { ProviderTestHarness } from '../../harness.js';

/**
 * Registers the purchases automated conformance suite. Because purchases can
 * only come into existence as the side effect of a completed checkout (the
 * SDK exposes no `purchases.create`), the automated suite is restricted to
 * input validation and list/get behavior when no purchase exists.
 *
 * This file is the spec for those scenarios; the brief is the source of
 * truth.
 */
export function registerPurchasesAutomatedSuite(
  label: string,
  factory: () => ProviderTestHarness | Promise<ProviderTestHarness>,
): void {
  // ---------------------------------------------------------------------------
  // Helpers (intentionally inlined per the task instructions — no shared util
  // library yet).
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

    // amount
    expect(isPlainObject(rec.amount)).toBe(true);
    const amt = rec.amount as Record<string, unknown>;
    expect(typeof amt.amount).toBe('number');
    expect(Number.isInteger(amt.amount)).toBe(true);
    expect((amt.amount as number) >= 0).toBe(true);
    expect(typeof amt.currency).toBe('string');
    expect(/^[a-z]{3}$/.test(amt.currency as string)).toBe(true);

    // amountRefunded
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

    // metadata
    expect(isPlainObject(rec.metadata)).toBe(true);
    for (const [k, v] of Object.entries(rec.metadata as Record<string, unknown>)) {
      expect(typeof v).toBe('string');
      expect(k.startsWith('__provider_')).toBe(false);
    }

    expect(rec.createdAt).toBeInstanceOf(Date);
    expect(Number.isFinite((rec.createdAt as Date).getTime())).toBe(true);
  }

  // ---------------------------------------------------------------------------
  // Outer describe — acquires harness once, registers per-method describes.
  // ---------------------------------------------------------------------------

  describe(`purchases [${label}]`, () => {
    let harness: ProviderTestHarness;
    let provider: BillingProvider;
    const createdCustomerIds = new Set<string>();

    beforeAll(async () => {
      harness = await factory();
      provider = harness.provider;
    });

    function trackCustomer(id: string): void {
      createdCustomerIds.add(id);
    }

    // -------------------------------------------------------------------------
    // purchases.list
    // -------------------------------------------------------------------------
    describe('purchases.list', () => {
      it('returns an array (never null/undefined) with no input', async () => {
        const out = await provider.purchases.list();
        expectIsPage<ProviderPurchase>(out);
        for (const p of out.data) expectIsPurchase(p);
      });

      it('returns an array with empty input', async () => {
        const out = await provider.purchases.list({});
        expectIsPage<ProviderPurchase>(out);
      });

      it('returns [] for a freshly created customer that has no purchases', async () => {
        const c = await provider.customers.create({});
        trackCustomer(c.id);
        const out = await provider.purchases.list({ customerId: c.id });
        expectIsPage<ProviderPurchase>(out);
        expect(out.data).toEqual([]);
      });

      it('returns [] (no throw) for a customerId that does not exist', async () => {
        const out = await provider.purchases.list({ customerId: 'cus_does_not_exist' });
        expectIsPage<ProviderPurchase>(out);
        expect(out.data).toEqual([]);
      });

      // ---- validation: input shape ----
      it.each([
        ['null', null],
        ['string', 'foo'],
        ['number', 42],
        ['boolean', true],
      ])('rejects non-object input (%s)', async (_l, value) => {
        await expect(provider.purchases.list(value as any)).rejects.toBeInstanceOf(
          ProviderValidationError,
        );
      });

      // ---- validation: customerId ----
      it.each([
        ['empty', ''],
        ['number', 42],
        ['boolean', true],
        ['object', { x: 1 }],
        ['null', null],
      ])('rejects invalid customerId (%s)', async (_l, value) => {
        await expect(
          provider.purchases.list({ customerId: value as any }),
        ).rejects.toBeInstanceOf(ProviderValidationError);
      });

      // ---- validation: status ----
      it.each([
        ['bogus value', 'bogus'],
        ['uppercase', 'SUCCEEDED'],
        ['number', 123],
        ['null', null],
        ['empty', ''],
      ])('rejects invalid status (%s)', async (_l, value) => {
        await expect(
          provider.purchases.list({ status: value as any }),
        ).rejects.toBeInstanceOf(ProviderValidationError);
      });

      // ---- validation: cursor ----
      it.each([
        ['empty', ''],
        ['number', 42],
        ['boolean', true],
        ['object', { x: 1 }],
      ])('rejects invalid cursor (%s)', async (_l, value) => {
        await expect(
          provider.purchases.list({ cursor: value as any }),
        ).rejects.toBeInstanceOf(ProviderValidationError);
      });

      // ---- validation: limit ----
      it.each([
        ['zero', 0],
        ['negative', -1],
        ['fractional', 1.5],
        ['too large', 101],
        ['string', '10'],
        ['NaN', Number.NaN],
      ])('rejects invalid limit (%s)', async (_l, value) => {
        await expect(
          provider.purchases.list({ limit: value as any }),
        ).rejects.toBeInstanceOf(ProviderValidationError);
      });
    });

    // -------------------------------------------------------------------------
    // purchases.get
    // -------------------------------------------------------------------------
    describe('purchases.get', () => {
      it('returns null (does not throw) for a missing id', async () => {
        const got = await provider.purchases.get({ id: 'pur_does_not_exist_xyz' });
        expect(got).toBeNull();
      });

      // ---- validation: input shape ----
      it.each([
        ['undefined', undefined],
        ['null', null],
        ['string', 'pur_123'],
        ['number', 42],
        ['boolean', true],
      ])('rejects non-object input (%s)', async (_l, value) => {
        await expect(provider.purchases.get(value as any)).rejects.toBeInstanceOf(
          ProviderValidationError,
        );
      });

      // ---- validation: id field ----
      it.each([
        ['missing', {}],
        ['empty', { id: '' }],
        ['null', { id: null as any }],
        ['number', { id: 42 as any }],
        ['boolean', { id: true as any }],
        ['object', { id: { x: 1 } as any }],
      ])('rejects invalid id (%s)', async (_l, input) => {
        await expect(provider.purchases.get(input as any)).rejects.toBeInstanceOf(
          ProviderValidationError,
        );
      });
    });

    // -------------------------------------------------------------------------
    // Best-effort cleanup
    // -------------------------------------------------------------------------
    afterAll(async () => {
      for (const id of createdCustomerIds) {
        try {
          await provider.customers.archive({ id });
        } catch {
          // Ignore cleanup failures.
        }
      }
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
