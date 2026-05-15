import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  MetadataCollisionError,
  ProviderConflictError,
  ProviderConstraintError,
  ProviderNotFoundError,
  ProviderValidationError,
} from '../../../errors/index.js';
import type {
  BillingProvider,
  DiscountBenefit,
  DiscountDuration,
  ProviderDiscount,
} from '../../../index.js';
import { withoutRaw } from '../../equality.js';
import type { ProviderTestHarness } from '../../harness.js';
import { nonNull } from '../../skip-if.js';

/**
 * Registers the discounts automated conformance suite. All scenarios in the
 * discounts brief are encoded here; this file is the spec, the brief is the
 * source of truth.
 */
export function registerDiscountsAutomatedSuite(
  label: string,
  factory: () => ProviderTestHarness | Promise<ProviderTestHarness>,
): void {
  // ---------------------------------------------------------------------------
  // Helpers (intentionally inlined per the task instructions — no shared util
  // library yet).
  // ---------------------------------------------------------------------------

  function uniqueCode(prefix = 'CODE'): string {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`.toUpperCase();
  }

  function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
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

  function expectIsDiscount(d: unknown): asserts d is ProviderDiscount {
    expect(isPlainObject(d)).toBe(true);
    const rec = d as Record<string, unknown>;

    expect(typeof rec.id).toBe('string');
    expect((rec.id as string).length).toBeGreaterThan(0);

    expect(rec.code === null || typeof rec.code === 'string').toBe(true);

    expect(typeof rec.active).toBe('boolean');

    expect(rec.expiresAt === null || rec.expiresAt instanceof Date).toBe(true);
    if (rec.expiresAt instanceof Date) {
      expect(Number.isFinite(rec.expiresAt.getTime())).toBe(true);
    }

    // benefit: discriminated union
    expect(isPlainObject(rec.benefit)).toBe(true);
    const benefit = rec.benefit as Record<string, unknown>;
    expect(benefit.kind === 'percent' || benefit.kind === 'amount').toBe(true);
    if (benefit.kind === 'percent') {
      expect(typeof benefit.percentOff).toBe('number');
      expect(benefit.percentOff as number).toBeGreaterThan(0);
      expect(benefit.percentOff as number).toBeLessThanOrEqual(100);
    } else {
      expect(isPlainObject(benefit.amountOff)).toBe(true);
      const m = benefit.amountOff as Record<string, unknown>;
      expect(typeof m.amount).toBe('number');
      expect(Number.isInteger(m.amount)).toBe(true);
      expect(m.amount as number).toBeGreaterThanOrEqual(0);
      expect(typeof m.currency).toBe('string');
      expect(/^[a-z]{3}$/.test(m.currency as string)).toBe(true);
    }

    // duration: discriminated union
    expect(isPlainObject(rec.duration)).toBe(true);
    const duration = rec.duration as Record<string, unknown>;
    expect(
      duration.kind === 'once' || duration.kind === 'forever' || duration.kind === 'repeating',
    ).toBe(true);
    if (duration.kind === 'repeating') {
      expect(typeof duration.months).toBe('number');
      expect(Number.isInteger(duration.months)).toBe(true);
      expect(duration.months as number).toBeGreaterThan(0);
    }

    // redemptionLimit
    expect(rec.redemptionLimit === null || typeof rec.redemptionLimit === 'number').toBe(true);
    if (typeof rec.redemptionLimit === 'number') {
      expect(Number.isInteger(rec.redemptionLimit)).toBe(true);
      expect(rec.redemptionLimit).toBeGreaterThan(0);
    }

    // redemptionCount
    expect(typeof rec.redemptionCount).toBe('number');
    expect(Number.isInteger(rec.redemptionCount)).toBe(true);
    expect(rec.redemptionCount as number).toBeGreaterThanOrEqual(0);

    // restrictedTo
    expect(rec.restrictedTo === null || isPlainObject(rec.restrictedTo)).toBe(true);
    if (isPlainObject(rec.restrictedTo)) {
      const r = rec.restrictedTo as Record<string, unknown>;
      if (r.productIds !== undefined) {
        expect(Array.isArray(r.productIds)).toBe(true);
        for (const p of r.productIds as unknown[]) {
          expect(typeof p).toBe('string');
          expect((p as string).length).toBeGreaterThan(0);
        }
      }
      if (r.priceIds !== undefined) {
        expect(Array.isArray(r.priceIds)).toBe(true);
        for (const p of r.priceIds as unknown[]) {
          expect(typeof p).toBe('string');
          expect((p as string).length).toBeGreaterThan(0);
        }
      }
    }

    // metadata
    expect(isPlainObject(rec.metadata)).toBe(true);
    for (const [k, v] of Object.entries(rec.metadata as Record<string, unknown>)) {
      expect(typeof v).toBe('string');
      expect(k.startsWith('__provider_')).toBe(false);
    }

    expect(rec.createdAt).toBeInstanceOf(Date);
    expect(Number.isFinite((rec.createdAt as Date).getTime())).toBe(true);
  }

  function expectCreatedAtRecent(d: ProviderDiscount): void {
    const now = Date.now();
    const fiveMinutes = 5 * 60 * 1000;
    const ts = d.createdAt.getTime();
    expect(ts).toBeGreaterThanOrEqual(now - fiveMinutes);
    expect(ts).toBeLessThanOrEqual(now + fiveMinutes);
  }

  const percent10: DiscountBenefit = { kind: 'percent', percentOff: 10 };
  const once: DiscountDuration = { kind: 'once' };

  // ---------------------------------------------------------------------------
  // Outer describe — acquires harness once, registers per-method describes.
  // ---------------------------------------------------------------------------

  describe(`discounts [${label}]`, () => {
    let harness: ProviderTestHarness;
    let provider: BillingProvider;
    const createdIds = new Set<string>();

    beforeAll(async () => {
      harness = await factory();
      provider = harness.provider;
    });

    /**
     * Track an id for best-effort archival at the end of the outer describe.
     */
    function track(id: string): void {
      createdIds.add(id);
    }

    // -------------------------------------------------------------------------
    // discounts.create
    // -------------------------------------------------------------------------
    describe('discounts.create', () => {
      it('creates with explicit code, percent benefit, once duration and sensible defaults', async () => {
        const code = uniqueCode('WELCOME10');
        const d = await provider.discounts.create({
          code,
          benefit: { kind: 'percent', percentOff: 10 },
          duration: { kind: 'once' },
        });
        track(d.id);
        expectIsDiscount(d);
        await harness.assertConsistency?.discount?.(d);
        expect(d.code).toBe(code);
        expect(d.benefit).toEqual({ kind: 'percent', percentOff: 10 });
        expect(d.duration).toEqual({ kind: 'once' });
        expect(d.active).toBe(true);
        expect(d.expiresAt).toBeNull();
        expect(d.redemptionLimit).toBeNull();
        expect(d.redemptionCount).toBe(0);
        expect(d.restrictedTo).toBeNull();
        expect(d.metadata).toEqual({});
        expectCreatedAtRecent(d);
      });

      it('omitted code yields code=null', async () => {
        const d = await provider.discounts.create({
          benefit: { kind: 'percent', percentOff: 50 },
          duration: { kind: 'forever' },
        });
        track(d.id);
        expectIsDiscount(d);
        await harness.assertConsistency?.discount?.(d);
        expect(d.code).toBeNull();
      });

      it('explicit code=null is accepted; repeating duration round-trips', async () => {
        const d = await provider.discounts.create({
          code: null,
          benefit: { kind: 'percent', percentOff: 25 },
          duration: { kind: 'repeating', months: 3 },
        });
        track(d.id);
        expectIsDiscount(d);
        await harness.assertConsistency?.discount?.(d);
        expect(d.code).toBeNull();
        expect(d.duration).toEqual({ kind: 'repeating', months: 3 });
      });

      it('amount benefit round-trips', async () => {
        const d = await provider.discounts.create({
          benefit: { kind: 'amount', amountOff: { amount: 500, currency: 'usd' } },
          duration: { kind: 'once' },
        });
        track(d.id);
        expectIsDiscount(d);
        await harness.assertConsistency?.discount?.(d);
        expect(d.benefit).toEqual({
          kind: 'amount',
          amountOff: { amount: 500, currency: 'usd' },
        });
      });

      it('expiresAt Date round-trips', async () => {
        const expiresAt = new Date('2099-01-01T00:00:00Z');
        const d = await provider.discounts.create({
          benefit: percent10,
          duration: once,
          expiresAt,
        });
        track(d.id);
        expectIsDiscount(d);
        await harness.assertConsistency?.discount?.(d);
        expect(d.expiresAt).toBeInstanceOf(Date);
        expect((d.expiresAt as Date).getTime()).toBe(expiresAt.getTime());
      });

      it('redemptionLimit round-trips', async () => {
        const d = await provider.discounts.create({
          benefit: percent10,
          duration: once,
          redemptionLimit: 100,
        });
        track(d.id);
        expectIsDiscount(d);
        await harness.assertConsistency?.discount?.(d);
        expect(d.redemptionLimit).toBe(100);
      });

      it('restrictedTo.productIds round-trips', async () => {
        const d = await provider.discounts.create({
          benefit: percent10,
          duration: once,
          restrictedTo: { productIds: ['prod_abc'] },
        });
        track(d.id);
        expectIsDiscount(d);
        await harness.assertConsistency?.discount?.(d);
        expect(d.restrictedTo).toEqual({ productIds: ['prod_abc'] });
      });

      it('restrictedTo.priceIds round-trips', async () => {
        const d = await provider.discounts.create({
          benefit: percent10,
          duration: once,
          restrictedTo: { priceIds: ['price_abc', 'price_def'] },
        });
        track(d.id);
        expectIsDiscount(d);
        await harness.assertConsistency?.discount?.(d);
        expect(d.restrictedTo).toEqual({ priceIds: ['price_abc', 'price_def'] });
      });

      it('metadata round-trips', async () => {
        const d = await provider.discounts.create({
          benefit: percent10,
          duration: once,
          metadata: { campaign: 'launch' },
        });
        track(d.id);
        expectIsDiscount(d);
        await harness.assertConsistency?.discount?.(d);
        expect(d.metadata).toEqual({ campaign: 'launch' });
      });

      // ---- validation: top-level input shape ----
      it.each([
        ['undefined', undefined],
        ['null', null],
        ['string', 'foo'],
        ['number', 42],
        ['boolean', true],
      ])('rejects non-object input (%s)', async (_label, value) => {
        await expect(provider.discounts.create(value as any)).rejects.toBeInstanceOf(
          ProviderValidationError,
        );
      });

      it('rejects missing benefit', async () => {
        await expect(provider.discounts.create({ duration: once } as any)).rejects.toBeInstanceOf(
          ProviderValidationError,
        );
      });

      it('rejects missing duration', async () => {
        await expect(
          provider.discounts.create({ benefit: percent10 } as any),
        ).rejects.toBeInstanceOf(ProviderValidationError);
      });

      // ---- validation: code ----
      it.each([
        ['empty string', ''],
        ['number', 123],
        ['boolean', true],
      ])('rejects invalid code (%s)', async (_label, value) => {
        await expect(
          provider.discounts.create({
            code: value as any,
            benefit: percent10,
            duration: once,
          }),
        ).rejects.toBeInstanceOf(ProviderValidationError);
      });

      // ---- validation: benefit shape ----
      it.each([
        ['string', 'pct'],
        ['number', 10],
        ['array', []],
        ['null', null],
      ])('rejects non-object benefit (%s)', async (_label, value) => {
        await expect(
          provider.discounts.create({ benefit: value as any, duration: once }),
        ).rejects.toBeInstanceOf(ProviderValidationError);
      });

      it('rejects benefit with missing kind', async () => {
        await expect(
          provider.discounts.create({ benefit: { percentOff: 10 } as any, duration: once }),
        ).rejects.toBeInstanceOf(ProviderValidationError);
      });

      it('rejects benefit with unknown kind', async () => {
        await expect(
          provider.discounts.create({
            benefit: { kind: 'pct', percentOff: 10 } as any,
            duration: once,
          }),
        ).rejects.toBeInstanceOf(ProviderValidationError);
      });

      // ---- validation: percent benefit ----
      it.each([
        ['zero', 0],
        ['negative', -10],
        ['101', 101],
        ['1000', 1000],
        ['missing', undefined],
        ['string', '10'],
        ['null', null],
        ['boolean', true],
        ['NaN', Number.NaN],
        ['Infinity', Number.POSITIVE_INFINITY],
        ['-Infinity', Number.NEGATIVE_INFINITY],
      ])('rejects invalid percent.percentOff (%s)', async (_label, value) => {
        const benefit: any = { kind: 'percent' };
        if (value !== undefined) benefit.percentOff = value;
        await expect(
          provider.discounts.create({ benefit: benefit as any, duration: once }),
        ).rejects.toBeInstanceOf(ProviderValidationError);
      });

      it.each([
        ['100', 100],
        ['0.5', 0.5],
        ['99.99', 99.99],
        ['50', 50],
      ])('accepts valid percent.percentOff (%s)', async (_label, value) => {
        const d = await provider.discounts.create({
          benefit: { kind: 'percent', percentOff: value as number },
          duration: once,
        });
        track(d.id);
        expectIsDiscount(d);
        await harness.assertConsistency?.discount?.(d);
        expect((d.benefit as { kind: 'percent'; percentOff: number }).percentOff).toBe(value);
      });

      // ---- validation: amount benefit ----
      it('rejects amount benefit with missing amountOff', async () => {
        await expect(
          provider.discounts.create({
            benefit: { kind: 'amount' } as any,
            duration: once,
          }),
        ).rejects.toBeInstanceOf(ProviderValidationError);
      });

      it.each([
        ['string', 'foo'],
        ['number', 500],
        ['null', null],
        ['array', []],
      ])('rejects amount benefit with non-object amountOff (%s)', async (_label, value) => {
        await expect(
          provider.discounts.create({
            benefit: { kind: 'amount', amountOff: value as any } as any,
            duration: once,
          }),
        ).rejects.toBeInstanceOf(ProviderValidationError);
      });

      it.each([
        ['-1', -1],
        ['fractional', 1.5],
        ['string', '500'],
        ['missing', undefined],
      ])('rejects amountOff.amount (%s)', async (_label, value) => {
        const amountOff: any = { currency: 'usd' };
        if (value !== undefined) amountOff.amount = value;
        await expect(
          provider.discounts.create({
            benefit: { kind: 'amount', amountOff } as any,
            duration: once,
          }),
        ).rejects.toBeInstanceOf(ProviderValidationError);
      });

      it.each([
        ['uppercase', 'USD'],
        ['two letters', 'us'],
        ['four letters', 'usdt'],
        ['empty', ''],
        ['mixed digits', 'US1'],
        ['missing', undefined],
        ['number', 123],
        ['null', null],
      ])('rejects amountOff.currency (%s)', async (_label, value) => {
        const amountOff: any = { amount: 500 };
        if (value !== undefined) amountOff.currency = value;
        await expect(
          provider.discounts.create({
            benefit: { kind: 'amount', amountOff } as any,
            duration: once,
          }),
        ).rejects.toBeInstanceOf(ProviderValidationError);
      });

      it('accepts amount=0 currency=usd', async () => {
        const d = await provider.discounts.create({
          benefit: { kind: 'amount', amountOff: { amount: 0, currency: 'usd' } },
          duration: once,
        });
        track(d.id);
        expectIsDiscount(d);
        await harness.assertConsistency?.discount?.(d);
        expect(d.benefit).toEqual({
          kind: 'amount',
          amountOff: { amount: 0, currency: 'usd' },
        });
      });

      it('accepts currency=eur', async () => {
        const d = await provider.discounts.create({
          benefit: { kind: 'amount', amountOff: { amount: 100, currency: 'eur' } },
          duration: once,
        });
        track(d.id);
        expectIsDiscount(d);
        await harness.assertConsistency?.discount?.(d);
        expect(
          (d.benefit as { kind: 'amount'; amountOff: { currency: string } }).amountOff.currency,
        ).toBe('eur');
      });

      // ---- validation: duration ----
      it('rejects duration with missing kind', async () => {
        await expect(
          provider.discounts.create({ benefit: percent10, duration: {} as any }),
        ).rejects.toBeInstanceOf(ProviderValidationError);
      });

      it('rejects unknown duration kind', async () => {
        await expect(
          provider.discounts.create({
            benefit: percent10,
            duration: { kind: 'monthly' } as any,
          }),
        ).rejects.toBeInstanceOf(ProviderValidationError);
      });

      it('rejects repeating without months', async () => {
        await expect(
          provider.discounts.create({
            benefit: percent10,
            duration: { kind: 'repeating' } as any,
          }),
        ).rejects.toBeInstanceOf(ProviderValidationError);
      });

      it.each([
        ['zero', 0],
        ['negative', -1],
        ['fractional', 1.5],
        ['string', '3'],
      ])('rejects repeating months (%s)', async (_label, value) => {
        await expect(
          provider.discounts.create({
            benefit: percent10,
            duration: { kind: 'repeating', months: value as any } as any,
          }),
        ).rejects.toBeInstanceOf(ProviderValidationError);
      });

      it.each([
        ['once', { kind: 'once' as const }],
        ['forever', { kind: 'forever' as const }],
        ['repeating months=1', { kind: 'repeating' as const, months: 1 }],
        ['repeating months=24', { kind: 'repeating' as const, months: 24 }],
      ])('accepts duration (%s)', async (_label, duration) => {
        const d = await provider.discounts.create({
          benefit: percent10,
          duration: duration as DiscountDuration,
        });
        track(d.id);
        expectIsDiscount(d);
        await harness.assertConsistency?.discount?.(d);
        expect(d.duration).toEqual(duration);
      });

      // ---- validation: expiresAt ----
      it('rejects expiresAt string', async () => {
        await expect(
          provider.discounts.create({
            benefit: percent10,
            duration: once,
            expiresAt: 'tomorrow' as any,
          }),
        ).rejects.toBeInstanceOf(ProviderValidationError);
      });

      it('rejects expiresAt Invalid Date', async () => {
        await expect(
          provider.discounts.create({
            benefit: percent10,
            duration: once,
            expiresAt: new Date('bad'),
          }),
        ).rejects.toBeInstanceOf(ProviderValidationError);
      });

      it('accepts expiresAt=null explicitly', async () => {
        const d = await provider.discounts.create({
          benefit: percent10,
          duration: once,
          expiresAt: null,
        });
        track(d.id);
        expectIsDiscount(d);
        await harness.assertConsistency?.discount?.(d);
        expect(d.expiresAt).toBeNull();
      });

      // ---- validation: redemptionLimit ----
      it.each([
        ['zero', 0],
        ['negative', -5],
        ['fractional', 1.5],
        ['string', '10'],
      ])('rejects redemptionLimit (%s)', async (_label, value) => {
        await expect(
          provider.discounts.create({
            benefit: percent10,
            duration: once,
            redemptionLimit: value as any,
          }),
        ).rejects.toBeInstanceOf(ProviderValidationError);
      });

      it('accepts redemptionLimit=null', async () => {
        const d = await provider.discounts.create({
          benefit: percent10,
          duration: once,
          redemptionLimit: null,
        });
        track(d.id);
        expectIsDiscount(d);
        await harness.assertConsistency?.discount?.(d);
        expect(d.redemptionLimit).toBeNull();
      });

      it('accepts redemptionLimit=1', async () => {
        const d = await provider.discounts.create({
          benefit: percent10,
          duration: once,
          redemptionLimit: 1,
        });
        track(d.id);
        expectIsDiscount(d);
        await harness.assertConsistency?.discount?.(d);
        expect(d.redemptionLimit).toBe(1);
      });

      // ---- validation: restrictedTo ----
      it.each([
        ['string', 'prod_abc'],
        ['number', 42],
        ['array', ['prod_abc']],
      ])('rejects non-object restrictedTo (%s)', async (_label, value) => {
        await expect(
          provider.discounts.create({
            benefit: percent10,
            duration: once,
            restrictedTo: value as any,
          }),
        ).rejects.toBeInstanceOf(ProviderValidationError);
      });

      it.each([
        ['null', null],
        ['empty object', {}],
        ['empty productIds', { productIds: [] }],
        ['productIds with one', { productIds: ['ok'] }],
        ['priceIds with one', { priceIds: ['ok'] }],
        ['both productIds and priceIds', { productIds: ['p1'], priceIds: ['pr1'] }],
      ])('accepts restrictedTo (%s)', async (_label, value) => {
        const d = await provider.discounts.create({
          benefit: percent10,
          duration: once,
          restrictedTo: value as any,
        });
        track(d.id);
        expectIsDiscount(d);
        await harness.assertConsistency?.discount?.(d);
      });

      it.each([
        ['productIds with empty', { productIds: [''] }],
        ['productIds with one valid one empty', { productIds: ['ok', ''] }],
        ['productIds with number', { productIds: [123] }],
        ['productIds as string', { productIds: 'prod_abc' }],
        ['priceIds with empty', { priceIds: [''] }],
      ])('rejects restrictedTo (%s)', async (_label, value) => {
        await expect(
          provider.discounts.create({
            benefit: percent10,
            duration: once,
            restrictedTo: value as any,
          }),
        ).rejects.toBeInstanceOf(ProviderValidationError);
      });

      // ---- validation: metadata ----
      it('rejects metadata with non-string values', async () => {
        await expect(
          provider.discounts.create({
            benefit: percent10,
            duration: once,
            metadata: { foo: 123 } as any,
          }),
        ).rejects.toBeInstanceOf(ProviderValidationError);
      });

      it('rejects non-object metadata', async () => {
        await expect(
          provider.discounts.create({
            benefit: percent10,
            duration: once,
            metadata: 'foo' as any,
          }),
        ).rejects.toBeInstanceOf(ProviderValidationError);
      });

      // ---- metadata collision ----
      it('throws MetadataCollisionError (422) for __provider_ prefix', async () => {
        const err = await provider.discounts
          .create({
            benefit: percent10,
            duration: once,
            metadata: { __provider_anything: 'x' } as any,
          })
          .then(
            () => null,
            (e: unknown) => e,
          );
        expect(err).toBeInstanceOf(MetadataCollisionError);
        expect((err as MetadataCollisionError).status).toBe(422);
        expect((err as MetadataCollisionError).reservedKeys.length).toBeGreaterThan(0);
        expect((err as MetadataCollisionError).reservedKeys).toContain('__provider_anything');
      });

      it('throws MetadataCollisionError for known reserved key', async () => {
        const err = await provider.discounts
          .create({
            benefit: percent10,
            duration: once,
            metadata: { __provider_quantity_min: '1' } as any,
          })
          .then(
            () => null,
            (e: unknown) => e,
          );
        expect(err).toBeInstanceOf(MetadataCollisionError);
        expect((err as MetadataCollisionError).reservedKeys).toContain('__provider_quantity_min');
      });

      it('mixed valid+reserved metadata still throws MetadataCollisionError', async () => {
        const err = await provider.discounts
          .create({
            benefit: percent10,
            duration: once,
            metadata: { campaign: 'launch', __provider_secret: 'x' } as any,
          })
          .then(
            () => null,
            (e: unknown) => e,
          );
        expect(err).toBeInstanceOf(MetadataCollisionError);
      });

      // ---- conflict ----
      it('two creates with same explicit code throws ProviderConflictError (409)', async () => {
        const code = uniqueCode('DUP');
        const first = await provider.discounts.create({
          code,
          benefit: percent10,
          duration: once,
        });
        track(first.id);
        await harness.assertConsistency?.discount?.(first);
        const err = await provider.discounts
          .create({ code, benefit: percent10, duration: once })
          .then(
            () => null,
            (e: unknown) => e,
          );
        expect(err).toBeInstanceOf(ProviderConflictError);
        expect((err as ProviderConflictError).status).toBe(409);
      });
    });

    // -------------------------------------------------------------------------
    // discounts.get
    // -------------------------------------------------------------------------
    describe('discounts.get', () => {
      it('returns a deep-equal record for an existing id', async () => {
        const d = await provider.discounts.create({
          code: uniqueCode('GET'),
          benefit: percent10,
          duration: once,
        });
        track(d.id);
        await harness.assertConsistency?.discount?.(d);
        const got = await provider.discounts.get({ id: d.id });
        expect(withoutRaw(nonNull(got, 'got'))).toEqual(withoutRaw(d));
      });

      it('created with code=null has code=null on read', async () => {
        const d = await provider.discounts.create({
          code: null,
          benefit: percent10,
          duration: once,
        });
        track(d.id);
        await harness.assertConsistency?.discount?.(d);
        const got = await provider.discounts.get({ id: d.id });
        expect(got).not.toBeNull();
        expectIsDiscount(got);
        expect(got.code).toBeNull();
      });

      it('created without restrictedTo has restrictedTo=null', async () => {
        const d = await provider.discounts.create({
          benefit: percent10,
          duration: once,
        });
        track(d.id);
        await harness.assertConsistency?.discount?.(d);
        const got = await provider.discounts.get({ id: d.id });
        expect(got).not.toBeNull();
        expectIsDiscount(got);
        expect(got.restrictedTo).toBeNull();
      });

      it('returns null (does not throw) for missing id', async () => {
        const got = await provider.discounts.get({
          id: 'disc_definitely_does_not_exist_xyz_123',
        });
        expect(got).toBeNull();
      });

      // ---- validation: input shape ----
      it.each([
        ['null', null],
        ['undefined', undefined],
        ['string', 'disc_x'],
        ['number', 42],
      ])('rejects non-object input (%s)', async (_label, value) => {
        await expect(provider.discounts.get(value as any)).rejects.toBeInstanceOf(
          ProviderValidationError,
        );
      });

      // ---- validation: id ----
      it.each([
        ['missing', {}],
        ['empty', { id: '' }],
        ['null', { id: null as any }],
        ['number', { id: 123 as any }],
      ])('rejects invalid id (%s)', async (_label, input) => {
        await expect(provider.discounts.get(input as any)).rejects.toBeInstanceOf(
          ProviderValidationError,
        );
      });
    });

    // -------------------------------------------------------------------------
    // discounts.list
    // -------------------------------------------------------------------------
    describe('discounts.list', () => {
      it('returns an array (never null/undefined) with no input', async () => {
        const out = await provider.discounts.list();
        expectIsPage<ProviderDiscount>(out);
        for (const d of out.data) expectIsDiscount(d);
      });

      it('returns an array (never null/undefined) with empty input', async () => {
        const out = await provider.discounts.list({});
        expectIsPage<ProviderDiscount>(out);
      });

      it('includes created discounts with redemptionCount=0', async () => {
        const a = await provider.discounts.create({
          code: uniqueCode('LIST'),
          benefit: percent10,
          duration: once,
        });
        const b = await provider.discounts.create({
          code: uniqueCode('LIST'),
          benefit: percent10,
          duration: once,
        });
        track(a.id);
        track(b.id);
        await harness.assertConsistency?.discount?.(a);
        await harness.assertConsistency?.discount?.(b);
        const seen = new Map<string, ProviderDiscount>();
        const page = await provider.discounts.list({ limit: 100 });
        expectIsPage<ProviderDiscount>(page);
        for (const d of page.data) seen.set(d.id, d);
        expect(seen.has(a.id)).toBe(true);
        expect(seen.has(b.id)).toBe(true);
        expect((seen.get(a.id) as ProviderDiscount).redemptionCount).toBe(0);
        expect((seen.get(b.id) as ProviderDiscount).redemptionCount).toBe(0);
      });

      it('list({active:true}) includes only active discounts', async () => {
        const d = await provider.discounts.create({
          code: uniqueCode('ACT'),
          benefit: percent10,
          duration: once,
        });
        track(d.id);
        await harness.assertConsistency?.discount?.(d);
        const out = await provider.discounts.list({ active: true, limit: 100 });
        expectIsPage<ProviderDiscount>(out);
        for (const r of out.data) {
          expectIsDiscount(r);
          expect(r.active).toBe(true);
        }
      });

      it('list({active:false}) includes only inactive discounts', async () => {
        const d = await provider.discounts.create({
          code: uniqueCode('INACT'),
          benefit: percent10,
          duration: once,
        });
        track(d.id);
        await harness.assertConsistency?.discount?.(d);
        const deactivated = await provider.discounts.deactivate({ id: d.id });
        if (deactivated !== null) {
          await harness.assertConsistency?.discount?.(deactivated);
        }
        const out = await provider.discounts.list({ active: false, limit: 100 });
        expectIsPage<ProviderDiscount>(out);
        for (const r of out.data) {
          expectIsDiscount(r);
          expect(r.active).toBe(false);
        }
      });

      // ---- validation: cursor ----
      it('rejects empty cursor', async () => {
        await expect(provider.discounts.list({ cursor: '' })).rejects.toBeInstanceOf(
          ProviderValidationError,
        );
      });

      it('rejects non-string cursor', async () => {
        await expect(provider.discounts.list({ cursor: 123 as any })).rejects.toBeInstanceOf(
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
      ])('rejects invalid limit (%s)', async (_label, value) => {
        await expect(provider.discounts.list({ limit: value as any })).rejects.toBeInstanceOf(
          ProviderValidationError,
        );
      });

      // ---- validation: active ----
      it.each([
        ['string', 'true'],
        ['number', 1],
        ['null', null],
      ])('rejects non-boolean active (%s)', async (_label, value) => {
        await expect(provider.discounts.list({ active: value as any })).rejects.toBeInstanceOf(
          ProviderValidationError,
        );
      });
    });

    // -------------------------------------------------------------------------
    // discounts.update
    // -------------------------------------------------------------------------
    describe('discounts.update', () => {
      it('deactivate({id}) sets active=false, other fields unchanged', async () => {
        const d = await provider.discounts.create({
          code: uniqueCode('UPD'),
          benefit: percent10,
          duration: once,
          metadata: { campaign: 'orig' },
        });
        track(d.id);
        await harness.assertConsistency?.discount?.(d);
        const deactivated = await provider.discounts.deactivate({ id: d.id });
        expect(deactivated).not.toBeNull();
        const u = deactivated as ProviderDiscount;
        expectIsDiscount(u);
        await harness.assertConsistency?.discount?.(u);
        expect(u.active).toBe(false);
        expect(u.id).toBe(d.id);
        expect(u.code).toBe(d.code);
        expect(u.benefit).toEqual(d.benefit);
        expect(u.duration).toEqual(d.duration);
        expect(u.metadata).toEqual(d.metadata);
        expect(u.createdAt.getTime()).toBe(d.createdAt.getTime());
      });

      it('update silently strips `active` (use deactivate / activate instead)', async () => {
        const d = await provider.discounts.create({
          code: uniqueCode('UPDA'),
          benefit: percent10,
          duration: once,
        });
        track(d.id);
        await harness.assertConsistency?.discount?.(d);
        // `active` is not part of the update input schema. Zod strips it.
        const u = await provider.discounts.update({ id: d.id, active: false } as any);
        expectIsDiscount(u);
        await harness.assertConsistency?.discount?.(u);
        expect(u.id).toBe(d.id);
        expect(u.active).toBe(true);
      });

      it('update({id, expiresAt:Date}) sets expiration', async () => {
        const d = await provider.discounts.create({
          benefit: percent10,
          duration: once,
          expiresAt: null,
        });
        track(d.id);
        await harness.assertConsistency?.discount?.(d);
        const expiresAt = new Date('2099-01-01T00:00:00Z');
        const u = await provider.discounts.update({ id: d.id, expiresAt });
        expectIsDiscount(u);
        await harness.assertConsistency?.discount?.(u);
        expect(u.expiresAt).toBeInstanceOf(Date);
        expect((u.expiresAt as Date).getTime()).toBe(expiresAt.getTime());
      });

      it('update({id, expiresAt:null}) clears expiration', async () => {
        const d = await provider.discounts.create({
          benefit: percent10,
          duration: once,
          expiresAt: new Date('2099-01-01T00:00:00Z'),
        });
        track(d.id);
        await harness.assertConsistency?.discount?.(d);
        const u = await provider.discounts.update({ id: d.id, expiresAt: null });
        expectIsDiscount(u);
        await harness.assertConsistency?.discount?.(u);
        expect(u.expiresAt).toBeNull();
      });

      it('update({id, metadata}) REPLACES metadata (does not merge)', async () => {
        const d = await provider.discounts.create({
          benefit: percent10,
          duration: once,
          metadata: { keep: 'no', also: 'no' },
        });
        track(d.id);
        await harness.assertConsistency?.discount?.(d);
        const u = await provider.discounts.update({
          id: d.id,
          metadata: { campaign: 'spring' },
        });
        expectIsDiscount(u);
        await harness.assertConsistency?.discount?.(u);
        expect(u.metadata).toEqual({ campaign: 'spring' });
      });

      it('update({id}) is a no-op and returns current record', async () => {
        const d = await provider.discounts.create({
          code: uniqueCode('NOOP'),
          benefit: percent10,
          duration: once,
          metadata: { a: '1' },
        });
        track(d.id);
        await harness.assertConsistency?.discount?.(d);
        const u = await provider.discounts.update({ id: d.id });
        expectIsDiscount(u);
        await harness.assertConsistency?.discount?.(u);
        expect(u.id).toBe(d.id);
        expect(u.code).toBe(d.code);
        expect(u.benefit).toEqual(d.benefit);
        expect(u.duration).toEqual(d.duration);
        expect(u.active).toBe(d.active);
        expect(u.metadata).toEqual(d.metadata);
        expect(u.createdAt.getTime()).toBe(d.createdAt.getTime());
      });

      // ---- validation: id ----
      it.each([
        ['missing', {}],
        ['empty', { id: '' }],
        ['null', { id: null as any }],
        ['number', { id: 42 as any }],
      ])('rejects invalid id (%s)', async (_label, input) => {
        await expect(provider.discounts.update(input as any)).rejects.toBeInstanceOf(
          ProviderValidationError,
        );
      });

      // ---- validation: expiresAt ----
      it('rejects expiresAt string', async () => {
        await expect(
          provider.discounts.update({ id: 'disc_x', expiresAt: 'tomorrow' as any }),
        ).rejects.toBeInstanceOf(ProviderValidationError);
      });

      it('rejects expiresAt Invalid Date', async () => {
        await expect(
          provider.discounts.update({ id: 'disc_x', expiresAt: new Date('bad') }),
        ).rejects.toBeInstanceOf(ProviderValidationError);
      });

      // ---- validation: metadata ----
      it('rejects metadata with non-string value', async () => {
        await expect(
          provider.discounts.update({ id: 'disc_x', metadata: { foo: 123 } as any }),
        ).rejects.toBeInstanceOf(ProviderValidationError);
      });

      it('rejects non-object metadata', async () => {
        await expect(
          provider.discounts.update({ id: 'disc_x', metadata: 'x' as any }),
        ).rejects.toBeInstanceOf(ProviderValidationError);
      });

      // ---- metadata collision ----
      it('throws MetadataCollisionError (422) for __provider_ key on update', async () => {
        const d = await provider.discounts.create({
          benefit: percent10,
          duration: once,
        });
        track(d.id);
        await harness.assertConsistency?.discount?.(d);
        const err = await provider.discounts
          .update({ id: d.id, metadata: { __provider_x: 'y' } as any })
          .then(
            () => null,
            (e: unknown) => e,
          );
        expect(err).toBeInstanceOf(MetadataCollisionError);
        expect((err as MetadataCollisionError).status).toBe(422);
      });

      // ---- immutable fields ----
      it.each([
        ['benefit', { benefit: { kind: 'percent', percentOff: 99 } }],
        ['duration', { duration: { kind: 'forever' } }],
        ['code', { code: 'NEW-CODE-XYZ' }],
        ['redemptionLimit', { redemptionLimit: 999 }],
      ])(
        'either rejects immutable field (%s) or leaves it unchanged after update',
        async (_label, patch) => {
          const d = await provider.discounts.create({
            code: uniqueCode('IMM'),
            benefit: { kind: 'percent', percentOff: 10 },
            duration: { kind: 'once' },
            redemptionLimit: 5,
          });
          track(d.id);
          await harness.assertConsistency?.discount?.(d);

          let threw = false;
          let caught: unknown = null;
          try {
            const updated = await provider.discounts.update({
              id: d.id,
              ...(patch as any),
            } as any);
            await harness.assertConsistency?.discount?.(updated);
          } catch (e) {
            threw = true;
            caught = e;
          }

          if (threw) {
            const okValidation = caught instanceof ProviderValidationError;
            const okConstraint = caught instanceof ProviderConstraintError;
            expect(okValidation || okConstraint).toBe(true);
            const status = (caught as { status?: number }).status;
            expect(status === 400 || status === 422).toBe(true);
          }

          // Whether it threw or silently dropped the field, the immutable
          // fields on the persisted record must be unchanged.
          const after = await provider.discounts.get({ id: d.id });
          expect(after).not.toBeNull();
          expectIsDiscount(after);
          expect(after.code).toBe(d.code);
          expect(after.benefit).toEqual(d.benefit);
          expect(after.duration).toEqual(d.duration);
          expect(after.redemptionLimit).toBe(d.redemptionLimit);
        },
      );

      // ---- missing id ----
      it('throws ProviderNotFoundError (404) on missing id', async () => {
        const err = await provider.discounts
          .update({
            id: 'disc_definitely_does_not_exist_xyz_999',
            metadata: { trace: 'x' },
          })
          .then(
            () => null,
            (e: unknown) => e,
          );
        expect(err).toBeInstanceOf(ProviderNotFoundError);
        expect((err as ProviderNotFoundError).status).toBe(404);
      });
    });

    // -------------------------------------------------------------------------
    // discounts.deactivate
    // -------------------------------------------------------------------------
    describe('discounts.deactivate', () => {
      it('deactivate returns record with active=false, immutable fields unchanged', async () => {
        const d = await provider.discounts.create({
          code: uniqueCode('ARC'),
          benefit: percent10,
          duration: once,
          redemptionLimit: 10,
        });
        track(d.id);
        await harness.assertConsistency?.discount?.(d);
        expect(d.active).toBe(true);
        const archived = await provider.discounts.deactivate({ id: d.id });
        expect(archived).not.toBeNull();
        expectIsDiscount(archived);
        await harness.assertConsistency?.discount?.(archived);
        expect(archived.id).toBe(d.id);
        expect(archived.active).toBe(false);
        expect(archived.code).toBe(d.code);
        expect(archived.benefit).toEqual(d.benefit);
        expect(archived.duration).toEqual(d.duration);
        expect(archived.redemptionLimit).toBe(d.redemptionLimit);
      });

      it('get returns the inactive record after deactivate', async () => {
        const d = await provider.discounts.create({
          benefit: percent10,
          duration: once,
        });
        track(d.id);
        await harness.assertConsistency?.discount?.(d);
        const deactivated = await provider.discounts.deactivate({ id: d.id });
        if (deactivated !== null) {
          await harness.assertConsistency?.discount?.(deactivated);
        }
        const got = await provider.discounts.get({ id: d.id });
        expect(got).not.toBeNull();
        expectIsDiscount(got);
        expect(got.active).toBe(false);
      });

      it('deactivate of missing id returns null (does not throw)', async () => {
        const out = await provider.discounts.deactivate({
          id: 'disc_definitely_does_not_exist_xyz_777',
        });
        expect(out).toBeNull();
      });

      it('double-deactivate is idempotent (returns record or null, never throws)', async () => {
        const d = await provider.discounts.create({
          benefit: percent10,
          duration: once,
        });
        track(d.id);
        await harness.assertConsistency?.discount?.(d);
        const first = await provider.discounts.deactivate({ id: d.id });
        expect(first).not.toBeNull();
        if (first !== null) {
          await harness.assertConsistency?.discount?.(first);
        }
        let second: ProviderDiscount | null = null;
        await expect(
          (async () => {
            second = await provider.discounts.deactivate({ id: d.id });
          })(),
        ).resolves.not.toThrow();
        if (second !== null) {
          expect((second as ProviderDiscount).id).toBe(d.id);
          expect((second as ProviderDiscount).active).toBe(false);
          await harness.assertConsistency?.discount?.(second);
        }
      });

      // ---- validation: input shape ----
      it.each([
        ['null', null],
        ['undefined', undefined],
        ['string', 'disc_x'],
        ['number', 42],
      ])('rejects non-object input (%s)', async (_label, value) => {
        await expect(provider.discounts.deactivate(value as any)).rejects.toBeInstanceOf(
          ProviderValidationError,
        );
      });

      // ---- validation: id ----
      it.each([
        ['missing', {}],
        ['empty', { id: '' }],
        ['null', { id: null as any }],
        ['number', { id: 42 as any }],
      ])('rejects invalid id (%s)', async (_label, input) => {
        await expect(provider.discounts.deactivate(input as any)).rejects.toBeInstanceOf(
          ProviderValidationError,
        );
      });
    });

    // -------------------------------------------------------------------------
    // discounts.activate
    // -------------------------------------------------------------------------
    describe('discounts.activate', () => {
      it('activates a deactivated discount; immutable fields preserved', async () => {
        const d = await provider.discounts.create({
          code: uniqueCode('ACTV'),
          benefit: percent10,
          duration: once,
          redemptionLimit: 5,
        });
        track(d.id);
        await harness.assertConsistency?.discount?.(d);
        const deactivated = await provider.discounts.deactivate({ id: d.id });
        if (deactivated !== null) {
          await harness.assertConsistency?.discount?.(deactivated);
        }

        const activated = await provider.discounts.activate({ id: d.id });
        expect(activated).not.toBeNull();
        expectIsDiscount(activated);
        await harness.assertConsistency?.discount?.(activated);
        expect(activated.id).toBe(d.id);
        expect(activated.active).toBe(true);
        expect(activated.code).toBe(d.code);
        expect(activated.benefit).toEqual(d.benefit);
        expect(activated.duration).toEqual(d.duration);
        expect(activated.redemptionLimit).toBe(d.redemptionLimit);
        expect(activated.createdAt.getTime()).toBe(d.createdAt.getTime());
      });

      it('activate of missing id returns null (does not throw)', async () => {
        const out = await provider.discounts.activate({
          id: 'disc_definitely_does_not_exist_xyz_888',
        });
        expect(out).toBeNull();
      });

      it('activating an already-active discount does not throw (idempotent)', async () => {
        const d = await provider.discounts.create({
          benefit: percent10,
          duration: once,
        });
        track(d.id);
        await harness.assertConsistency?.discount?.(d);
        let result: ProviderDiscount | null = null;
        await expect(
          (async () => {
            result = await provider.discounts.activate({ id: d.id });
          })(),
        ).resolves.not.toThrow();
        if (result !== null) {
          expect((result as ProviderDiscount).id).toBe(d.id);
          expect((result as ProviderDiscount).active).toBe(true);
          await harness.assertConsistency?.discount?.(result);
        }
      });

      // ---- validation: input shape ----
      it.each([
        ['null', null],
        ['undefined', undefined],
        ['string', 'disc_x'],
        ['number', 42],
      ])('rejects non-object input (%s)', async (_label, value) => {
        await expect(provider.discounts.activate(value as any)).rejects.toBeInstanceOf(
          ProviderValidationError,
        );
      });

      // ---- validation: id ----
      it.each([
        ['missing', {}],
        ['empty', { id: '' }],
        ['null', { id: null as any }],
        ['number', { id: 42 as any }],
      ])('rejects invalid id (%s)', async (_label, input) => {
        await expect(provider.discounts.activate(input as any)).rejects.toBeInstanceOf(
          ProviderValidationError,
        );
      });
    });

    // -------------------------------------------------------------------------
    // Best-effort cleanup.
    // -------------------------------------------------------------------------
    afterAll(async () => {
      for (const id of createdIds) {
        try {
          await provider.discounts.deactivate({ id });
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
