import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ProviderValidationError } from '../../../errors/index.js';
import type { BillingProvider, ProviderPayment } from '../../../index.js';
import type { ProviderTestHarness } from '../../harness.js';

/**
 * Registers the payments automated conformance suite. Because payments can
 * only come into existence as the side effect of a completed checkout (the
 * SDK exposes no `payments.create`), the automated suite is restricted to
 * input validation and list/get behavior when no payment exists.
 *
 * This file is the spec for those scenarios; the brief is the source of
 * truth.
 */
export function registerPaymentsAutomatedSuite(
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

  const PAYMENT_STATUSES = new Set([
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

  function expectIsPayment(p: unknown): asserts p is ProviderPayment {
    expect(isPlainObject(p)).toBe(true);
    const rec = p as Record<string, unknown>;

    expect(typeof rec.id).toBe('string');
    expect((rec.id as string).length).toBeGreaterThan(0);

    expect(rec.customerId === null || typeof rec.customerId === 'string').toBe(true);
    expect(typeof rec.status).toBe('string');
    expect(PAYMENT_STATUSES.has(rec.status as string)).toBe(true);

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

    // subtotal (optional)
    if ('subtotal' in rec && rec.subtotal !== undefined) {
      expect(isPlainObject(rec.subtotal)).toBe(true);
      const sub = rec.subtotal as Record<string, unknown>;
      expect(typeof sub.amount).toBe('number');
      expect(Number.isInteger(sub.amount)).toBe(true);
      expect((sub.amount as number) >= 0).toBe(true);
      expect(typeof sub.currency).toBe('string');
      expect(/^[a-z]{3}$/.test(sub.currency as string)).toBe(true);
    }

    // appliedDiscounts: required array; entries shape-checked
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
      expect(/^[a-z]{3}$/.test(amt.currency as string)).toBe(true);
      // Currency invariant: applied-discount currency must match payment amount
      expect(amt.currency).toBe((rec.amount as Record<string, unknown>).currency);
    }

    expect(rec.priceId === null || typeof rec.priceId === 'string').toBe(true);
    expect(rec.productId === null || typeof rec.productId === 'string').toBe(true);
    expect(rec.checkoutSessionId === null || typeof rec.checkoutSessionId === 'string').toBe(true);

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

  describe(`payments [${label}]`, () => {
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
    // payments.list
    // -------------------------------------------------------------------------
    describe('payments.list', () => {
      it('returns an array (never null/undefined) with no input', async () => {
        const out = await provider.payments.list();
        expectIsPage<ProviderPayment>(out);
        for (const p of out.data) expectIsPayment(p);
      });

      it('returns an array with empty input', async () => {
        const out = await provider.payments.list({});
        expectIsPage<ProviderPayment>(out);
      });

      it('returns [] for a freshly created customer that has no payments', async () => {
        const c = await provider.customers.create({});
        trackCustomer(c.id);
        const out = await provider.payments.list({ customerId: c.id });
        expectIsPage<ProviderPayment>(out);
        expect(out.data).toEqual([]);
      });

      it('returns [] (no throw) for a customerId that does not exist', async () => {
        const out = await provider.payments.list({ customerId: 'cus_does_not_exist' });
        expectIsPage<ProviderPayment>(out);
        expect(out.data).toEqual([]);
      });

      // ---- validation: input shape ----
      it.each([
        ['null', null],
        ['string', 'foo'],
        ['number', 42],
        ['boolean', true],
      ])('rejects non-object input (%s)', async (_l, value) => {
        await expect(provider.payments.list(value as any)).rejects.toBeInstanceOf(
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
        await expect(provider.payments.list({ customerId: value as any })).rejects.toBeInstanceOf(
          ProviderValidationError,
        );
      });

      // ---- validation: status ----
      it.each([
        ['bogus value', 'bogus'],
        ['uppercase', 'SUCCEEDED'],
        ['number', 123],
        ['null', null],
        ['empty', ''],
      ])('rejects invalid status (%s)', async (_l, value) => {
        await expect(provider.payments.list({ status: value as any })).rejects.toBeInstanceOf(
          ProviderValidationError,
        );
      });

      // ---- validation: cursor ----
      it.each([
        ['empty', ''],
        ['number', 42],
        ['boolean', true],
        ['object', { x: 1 }],
      ])('rejects invalid cursor (%s)', async (_l, value) => {
        await expect(provider.payments.list({ cursor: value as any })).rejects.toBeInstanceOf(
          ProviderValidationError,
        );
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
        await expect(provider.payments.list({ limit: value as any })).rejects.toBeInstanceOf(
          ProviderValidationError,
        );
      });
    });

    // -------------------------------------------------------------------------
    // payments.get
    // -------------------------------------------------------------------------
    describe('payments.get', () => {
      it('returns null (does not throw) for a missing id', async () => {
        const got = await provider.payments.get({ id: 'pay_does_not_exist_xyz' });
        expect(got).toBeNull();
      });

      // ---- validation: input shape ----
      it.each([
        ['undefined', undefined],
        ['null', null],
        ['string', 'pay_123'],
        ['number', 42],
        ['boolean', true],
      ])('rejects non-object input (%s)', async (_l, value) => {
        await expect(provider.payments.get(value as any)).rejects.toBeInstanceOf(
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
        await expect(provider.payments.get(input as any)).rejects.toBeInstanceOf(
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
