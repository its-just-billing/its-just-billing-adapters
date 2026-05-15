import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  MetadataCollisionError,
  ProviderConstraintError,
  ProviderNotFoundError,
  ProviderValidationError,
} from '../../../errors/index.js';
import type { BillingProvider, ProviderPrice, ProviderProduct } from '../../../index.js';
import { withoutRaw } from '../../equality.js';
import type { ProviderTestHarness } from '../../harness.js';
import { nonNull } from '../../skip-if.js';

/**
 * Registers the prices automated conformance suite. All scenarios in the
 * prices brief are encoded here; this file is the spec, the brief is the
 * source of truth.
 */
export function registerPricesAutomatedSuite(
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

  function isPositiveInt(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value > 0;
  }

  function isNonNegativeInt(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0;
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

  function expectIsPrice(p: unknown): asserts p is ProviderPrice {
    expect(isPlainObject(p)).toBe(true);
    const rec = p as Record<string, unknown>;

    expect(typeof rec.id).toBe('string');
    expect((rec.id as string).length).toBeGreaterThan(0);

    expect(typeof rec.productId).toBe('string');
    expect((rec.productId as string).length).toBeGreaterThan(0);

    expect(typeof rec.active).toBe('boolean');

    expect(typeof rec.currency).toBe('string');
    expect(/^[a-z]{3}$/.test(rec.currency as string)).toBe(true);

    // quantity
    expect(isPlainObject(rec.quantity)).toBe(true);
    const q = rec.quantity as Record<string, unknown>;
    expect(isPositiveInt(q.min)).toBe(true);
    if (q.max !== undefined) {
      expect(isPositiveInt(q.max)).toBe(true);
      expect((q.max as number) >= (q.min as number)).toBe(true);
    }

    // kind discriminated union
    expect(rec.kind === 'one_time' || rec.kind === 'recurring').toBe(true);
    expect(isNonNegativeInt(rec.unitAmount)).toBe(true);
    if (rec.kind === 'recurring') {
      expect(['day', 'week', 'month', 'year']).toContain(rec.interval);
      expect(isPositiveInt(rec.intervalCount)).toBe(true);
    }

    // metadata
    expect(isPlainObject(rec.metadata)).toBe(true);
    for (const [k, v] of Object.entries(rec.metadata as Record<string, unknown>)) {
      expect(typeof v).toBe('string');
      expect(k.startsWith('__provider_')).toBe(false);
    }

    // timestamps
    expect(rec.createdAt).toBeInstanceOf(Date);
    expect(rec.updatedAt).toBeInstanceOf(Date);
    expect(Number.isFinite((rec.createdAt as Date).getTime())).toBe(true);
    expect(Number.isFinite((rec.updatedAt as Date).getTime())).toBe(true);
    expect((rec.createdAt as Date).getTime()).toBeLessThanOrEqual(
      (rec.updatedAt as Date).getTime(),
    );
  }

  // ---------------------------------------------------------------------------
  // Outer describe — acquires harness once, registers per-method describes.
  // ---------------------------------------------------------------------------

  describe(`prices [${label}]`, () => {
    let harness: ProviderTestHarness;
    let provider: BillingProvider;
    let fixtureProduct: ProviderProduct;
    const createdPriceIds = new Set<string>();
    const createdProductIds = new Set<string>();

    beforeAll(async () => {
      harness = await factory();
      provider = harness.provider;
      fixtureProduct = await provider.products.create({
        name: 'fixture-prod',
        taxCategory: 'saas',
      });
      createdProductIds.add(fixtureProduct.id);
      await harness.assertConsistency?.product?.(fixtureProduct);
    });

    function trackPrice(id: string): void {
      createdPriceIds.add(id);
    }

    function trackProduct(id: string): void {
      createdProductIds.add(id);
    }

    // -------------------------------------------------------------------------
    // prices.create
    // -------------------------------------------------------------------------
    describe('prices.create', () => {
      it('creates a one_time price with sensible defaults', async () => {
        const p = await provider.prices.create({
          productId: fixtureProduct.id,
          currency: 'usd',
          kind: 'one_time',
          unitAmount: 1999,
        });
        trackPrice(p.id);
        expectIsPrice(p);
        await harness.assertConsistency?.price?.(p);
        expect(p.productId).toBe(fixtureProduct.id);
        expect(p.currency).toBe('usd');
        expect(p.kind).toBe('one_time');
        if (p.kind === 'one_time') {
          expect(p.unitAmount).toBe(1999);
        }
        expect(p.active).toBe(true);
        expect(p.quantity).toEqual({ min: 1 });
        expect(p.metadata).toEqual({});
        expect(p.createdAt.getTime()).toBeLessThanOrEqual(p.updatedAt.getTime());
      });

      it('creates a recurring price with default intervalCount=1 and fixed quantity', async () => {
        // intervalCount is intentionally omitted to test the default-of-1
        // behavior; the schema accepts it at runtime via the default.
        const p = await provider.prices.create({
          productId: fixtureProduct.id,
          currency: 'usd',
          kind: 'recurring',
          unitAmount: 999,
          interval: 'month',
        } as any);
        trackPrice(p.id);
        expectIsPrice(p);
        await harness.assertConsistency?.price?.(p);
        expect(p.kind).toBe('recurring');
        if (p.kind === 'recurring') {
          expect(p.interval).toBe('month');
          expect(p.intervalCount).toBe(1);
          expect(p.unitAmount).toBe(999);
        }
        expect(p.quantity).toEqual({ min: 1, max: 1 });
      });

      it('respects an explicit intervalCount on recurring', async () => {
        const p = await provider.prices.create({
          productId: fixtureProduct.id,
          currency: 'usd',
          kind: 'recurring',
          unitAmount: 500,
          interval: 'month',
          intervalCount: 3,
        });
        trackPrice(p.id);
        expectIsPrice(p);
        await harness.assertConsistency?.price?.(p);
        if (p.kind === 'recurring') {
          expect(p.intervalCount).toBe(3);
        }
      });

      it('round-trips an explicit quantity on a one_time price', async () => {
        const p = await provider.prices.create({
          productId: fixtureProduct.id,
          currency: 'usd',
          kind: 'one_time',
          unitAmount: 100,
          quantity: { min: 2, max: 5 },
        });
        trackPrice(p.id);
        expectIsPrice(p);
        await harness.assertConsistency?.price?.(p);
        expect(p.quantity).toEqual({ min: 2, max: 5 });
      });

      it('round-trips metadata with no __provider_* keys leaked', async () => {
        const metadata = { plan: 'pro', region: 'us' };
        const p = await provider.prices.create({
          productId: fixtureProduct.id,
          currency: 'usd',
          kind: 'one_time',
          unitAmount: 100,
          metadata,
        });
        trackPrice(p.id);
        expectIsPrice(p);
        await harness.assertConsistency?.price?.(p);
        expect(p.metadata).toEqual(metadata);
        for (const k of Object.keys(p.metadata)) {
          expect(k.startsWith('__provider_')).toBe(false);
        }
      });

      // ---- validation: input shape ----
      it.each([
        ['null', null],
        ['undefined', undefined],
        ['empty object', {}],
      ])('rejects invalid base input (%s)', async (_l, value) => {
        await expect(provider.prices.create(value as any)).rejects.toBeInstanceOf(
          ProviderValidationError,
        );
      });

      // ---- validation: productId ----
      it.each([
        ['empty', ''],
        ['number', 42],
        ['null', null],
      ])('rejects invalid productId (%s)', async (_l, value) => {
        await expect(
          provider.prices.create({
            productId: value as any,
            currency: 'usd',
            kind: 'one_time',
            unitAmount: 100,
          } as any),
        ).rejects.toBeInstanceOf(ProviderValidationError);
      });

      it('rejects missing productId', async () => {
        await expect(
          provider.prices.create({
            currency: 'usd',
            kind: 'one_time',
            unitAmount: 100,
          } as any),
        ).rejects.toBeInstanceOf(ProviderValidationError);
      });

      // ---- validation: currency ----
      it.each([
        ['uppercase', 'USD'],
        ['too short', 'us'],
        ['too long', 'usdt'],
        ['contains digit', 'us1'],
        ['empty', ''],
        ['number', 123],
        ['null', null],
      ])('rejects invalid currency (%s)', async (_l, value) => {
        await expect(
          provider.prices.create({
            productId: fixtureProduct.id,
            currency: value as any,
            kind: 'one_time',
            unitAmount: 100,
          } as any),
        ).rejects.toBeInstanceOf(ProviderValidationError);
      });

      it('rejects missing currency', async () => {
        await expect(
          provider.prices.create({
            productId: fixtureProduct.id,
            kind: 'one_time',
            unitAmount: 100,
          } as any),
        ).rejects.toBeInstanceOf(ProviderValidationError);
      });

      // ---- validation: kind ----
      it.each([
        ['unknown kind', { kind: 'foo' }],
        ['null kind', { kind: null }],
      ])('rejects invalid kind (%s)', async (_l, override) => {
        await expect(
          provider.prices.create({
            productId: fixtureProduct.id,
            currency: 'usd',
            unitAmount: 100,
            ...(override as any),
          } as any),
        ).rejects.toBeInstanceOf(ProviderValidationError);
      });

      it('rejects missing kind', async () => {
        await expect(
          provider.prices.create({
            productId: fixtureProduct.id,
            currency: 'usd',
            unitAmount: 100,
          } as any),
        ).rejects.toBeInstanceOf(ProviderValidationError);
      });

      // ---- validation: one_time unitAmount ----
      it('rejects one_time with missing unitAmount', async () => {
        await expect(
          provider.prices.create({
            productId: fixtureProduct.id,
            currency: 'usd',
            kind: 'one_time',
          } as any),
        ).rejects.toBeInstanceOf(ProviderValidationError);
      });

      it.each([
        ['negative', -1],
        ['fractional', 1.5],
        ['string', '100'],
        ['NaN', Number.NaN],
      ])('rejects one_time unitAmount (%s)', async (_l, value) => {
        await expect(
          provider.prices.create({
            productId: fixtureProduct.id,
            currency: 'usd',
            kind: 'one_time',
            unitAmount: value as any,
          } as any),
        ).rejects.toBeInstanceOf(ProviderValidationError);
      });

      // ---- validation: recurring fields ----
      it('rejects recurring without interval', async () => {
        await expect(
          provider.prices.create({
            productId: fixtureProduct.id,
            currency: 'usd',
            kind: 'recurring',
            unitAmount: 100,
          } as any),
        ).rejects.toBeInstanceOf(ProviderValidationError);
      });

      it.each([
        ['unknown interval', 'fortnight'],
        ['wrong case', 'Month'],
      ])('rejects recurring interval (%s)', async (_l, value) => {
        await expect(
          provider.prices.create({
            productId: fixtureProduct.id,
            currency: 'usd',
            kind: 'recurring',
            unitAmount: 100,
            interval: value as any,
          } as any),
        ).rejects.toBeInstanceOf(ProviderValidationError);
      });

      it.each([
        ['zero', 0],
        ['negative', -1],
        ['fractional', 1.5],
        ['string', '2'],
      ])('rejects recurring intervalCount (%s)', async (_l, value) => {
        await expect(
          provider.prices.create({
            productId: fixtureProduct.id,
            currency: 'usd',
            kind: 'recurring',
            unitAmount: 100,
            interval: 'month',
            intervalCount: value as any,
          } as any),
        ).rejects.toBeInstanceOf(ProviderValidationError);
      });

      it('rejects recurring with negative unitAmount', async () => {
        await expect(
          provider.prices.create({
            productId: fixtureProduct.id,
            currency: 'usd',
            kind: 'recurring',
            unitAmount: -1,
            interval: 'month',
          } as any),
        ).rejects.toBeInstanceOf(ProviderValidationError);
      });

      // ---- validation: quantity ----
      it.each([
        ['min=0', { min: 0 }],
        ['min=-1', { min: -1 }],
        ['min fractional', { min: 1.5 }],
        ['min string', { min: '1' }],
        ['max=0', { min: 1, max: 0 }],
        ['max < min', { min: 5, max: 2 }],
        ['max fractional', { min: 1, max: 1.5 }],
        ['missing min', {}],
        ['null quantity', null],
      ])('rejects invalid quantity (%s)', async (_l, value) => {
        await expect(
          provider.prices.create({
            productId: fixtureProduct.id,
            currency: 'usd',
            kind: 'one_time',
            unitAmount: 100,
            quantity: value as any,
          } as any),
        ).rejects.toBeInstanceOf(ProviderValidationError);
      });

      // ---- validation: metadata ----
      it('rejects non-object metadata', async () => {
        await expect(
          provider.prices.create({
            productId: fixtureProduct.id,
            currency: 'usd',
            kind: 'one_time',
            unitAmount: 100,
            metadata: 'not-obj' as any,
          } as any),
        ).rejects.toBeInstanceOf(ProviderValidationError);
      });

      it.each([
        ['number value', { x: 1 }],
        ['null value', { x: null }],
      ])('rejects metadata with non-string values (%s)', async (_l, metadata) => {
        await expect(
          provider.prices.create({
            productId: fixtureProduct.id,
            currency: 'usd',
            kind: 'one_time',
            unitAmount: 100,
            metadata: metadata as any,
          } as any),
        ).rejects.toBeInstanceOf(ProviderValidationError);
      });

      // ---- collision ----
      it('throws MetadataCollisionError (422) for __provider_ keys', async () => {
        const err = await provider.prices
          .create({
            productId: fixtureProduct.id,
            currency: 'usd',
            kind: 'one_time',
            unitAmount: 100,
            metadata: { __provider_anything: 'x' } as any,
          })
          .then(
            () => null,
            (e: unknown) => e,
          );
        expect(err).toBeInstanceOf(MetadataCollisionError);
        expect((err as MetadataCollisionError).status).toBe(422);
        expect((err as MetadataCollisionError).reservedKeys).toContain('__provider_anything');
      });

      it('throws MetadataCollisionError (422) for __provider_quantity_min', async () => {
        const err = await provider.prices
          .create({
            productId: fixtureProduct.id,
            currency: 'usd',
            kind: 'one_time',
            unitAmount: 100,
            metadata: { __provider_quantity_min: '1' } as any,
          })
          .then(
            () => null,
            (e: unknown) => e,
          );
        expect(err).toBeInstanceOf(MetadataCollisionError);
        expect((err as MetadataCollisionError).status).toBe(422);
        expect((err as MetadataCollisionError).reservedKeys).toContain('__provider_quantity_min');
      });

      // ---- provider-mapped ----
      it('throws ProviderNotFoundError (404) for an invalid productId', async () => {
        const err = await provider.prices
          .create({
            productId: 'prod_definitely_does_not_exist_xyz_123',
            currency: 'usd',
            kind: 'one_time',
            unitAmount: 100,
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
    // prices.get
    // -------------------------------------------------------------------------
    describe('prices.get', () => {
      it('returns a deep-equal record for an existing id', async () => {
        const a = await provider.prices.create({
          productId: fixtureProduct.id,
          currency: 'usd',
          kind: 'one_time',
          unitAmount: 100,
        });
        trackPrice(a.id);
        await harness.assertConsistency?.price?.(a);
        const got = await provider.prices.get({ id: a.id });
        expect(withoutRaw(nonNull(got, 'got'))).toEqual(withoutRaw(a));
      });

      it('returns null for a missing id', async () => {
        const got = await provider.prices.get({ id: 'price_x_missing' });
        expect(got).toBeNull();
      });

      it('round-trips quantity {min:2,max:5}', async () => {
        const p = await provider.prices.create({
          productId: fixtureProduct.id,
          currency: 'usd',
          kind: 'one_time',
          unitAmount: 100,
          quantity: { min: 2, max: 5 },
        });
        trackPrice(p.id);
        await harness.assertConsistency?.price?.(p);
        const got = await provider.prices.get({ id: p.id });
        expect(got).not.toBeNull();
        expect((got as ProviderPrice).quantity).toEqual({ min: 2, max: 5 });
      });

      it('round-trips metadata with no __provider_* keys', async () => {
        const metadata = { tier: 'gold', team: 'a' };
        const p = await provider.prices.create({
          productId: fixtureProduct.id,
          currency: 'usd',
          kind: 'one_time',
          unitAmount: 100,
          metadata,
        });
        trackPrice(p.id);
        await harness.assertConsistency?.price?.(p);
        const got = await provider.prices.get({ id: p.id });
        expect(got).not.toBeNull();
        expect((got as ProviderPrice).metadata).toEqual(metadata);
        for (const k of Object.keys((got as ProviderPrice).metadata)) {
          expect(k.startsWith('__provider_')).toBe(false);
        }
      });

      // ---- validation: id field ----
      it.each([
        ['missing', {}],
        ['empty', { id: '' }],
        ['null', { id: null as any }],
        ['number', { id: 42 as any }],
      ])('rejects invalid id (%s)', async (_l, input) => {
        await expect(provider.prices.get(input as any)).rejects.toBeInstanceOf(
          ProviderValidationError,
        );
      });

      // ---- validation: input shape ----
      it.each([
        ['null', null],
        ['undefined', undefined],
      ])('rejects invalid input (%s)', async (_l, value) => {
        await expect(provider.prices.get(value as any)).rejects.toBeInstanceOf(
          ProviderValidationError,
        );
      });
    });

    // -------------------------------------------------------------------------
    // prices.list
    // -------------------------------------------------------------------------
    describe('prices.list', () => {
      it('filters by productId; active filter excludes archived', async () => {
        const localProduct = await provider.products.create({
          name: 'fixture-list',
          taxCategory: 'saas',
        });
        trackProduct(localProduct.id);
        await harness.assertConsistency?.product?.(localProduct);

        const a = await provider.prices.create({
          productId: localProduct.id,
          currency: 'usd',
          kind: 'one_time',
          unitAmount: 100,
        });
        trackPrice(a.id);
        await harness.assertConsistency?.price?.(a);
        const b = await provider.prices.create({
          productId: localProduct.id,
          currency: 'usd',
          kind: 'recurring',
          unitAmount: 200,
          interval: 'month',
          intervalCount: 1,
        });
        trackPrice(b.id);
        await harness.assertConsistency?.price?.(b);

        const all = await provider.prices.list({ productId: localProduct.id });
        expectIsPage<ProviderPrice>(all);
        const allIds = new Set(all.data.map((p) => p.id));
        expect(allIds.has(a.id)).toBe(true);
        expect(allIds.has(b.id)).toBe(true);
        for (const p of all.data) expectIsPrice(p);

        const activeBefore = await provider.prices.list({
          productId: localProduct.id,
          active: true,
        });
        expectIsPage<ProviderPrice>(activeBefore);
        const activeBeforeIds = new Set(activeBefore.data.map((p) => p.id));
        expect(activeBeforeIds.has(a.id)).toBe(true);
        expect(activeBeforeIds.has(b.id)).toBe(true);

        const deactivated = await provider.prices.deactivate({ id: a.id });
        if (deactivated !== null) {
          await harness.assertConsistency?.price?.(deactivated);
        }

        const activeAfter = await provider.prices.list({
          productId: localProduct.id,
          active: true,
        });
        expectIsPage<ProviderPrice>(activeAfter);
        const activeAfterIds = new Set(activeAfter.data.map((p) => p.id));
        expect(activeAfterIds.has(a.id)).toBe(false);
        expect(activeAfterIds.has(b.id)).toBe(true);

        const inactive = await provider.prices.list({
          productId: localProduct.id,
          active: false,
        });
        expectIsPage<ProviderPrice>(inactive);
        const inactiveIds = new Set(inactive.data.map((p) => p.id));
        expect(inactiveIds.has(a.id)).toBe(true);
      });

      // ---- validation: cursor ----
      it.each([
        ['empty', ''],
        ['number', 42],
      ])('rejects invalid cursor (%s)', async (_l, value) => {
        await expect(provider.prices.list({ cursor: value as any })).rejects.toBeInstanceOf(
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
      ])('rejects invalid limit (%s)', async (_l, value) => {
        await expect(provider.prices.list({ limit: value as any })).rejects.toBeInstanceOf(
          ProviderValidationError,
        );
      });

      // ---- validation: productId ----
      it.each([
        ['empty', ''],
        ['number', 42],
      ])('rejects invalid productId (%s)', async (_l, value) => {
        await expect(provider.prices.list({ productId: value as any })).rejects.toBeInstanceOf(
          ProviderValidationError,
        );
      });

      // ---- validation: active ----
      it.each([
        ['string', 'true'],
        ['number', 1],
        ['null', null],
      ])('rejects invalid active filter (%s)', async (_l, value) => {
        await expect(provider.prices.list({ active: value as any })).rejects.toBeInstanceOf(
          ProviderValidationError,
        );
      });
    });

    // -------------------------------------------------------------------------
    // prices.update
    // -------------------------------------------------------------------------
    describe('prices.update', () => {
      it('deactivate({id}) flips active and leaves immutable fields', async () => {
        const a = await provider.prices.create({
          productId: fixtureProduct.id,
          currency: 'usd',
          kind: 'recurring',
          unitAmount: 1500,
          interval: 'month',
          intervalCount: 2,
        });
        trackPrice(a.id);
        await harness.assertConsistency?.price?.(a);
        const before = a.updatedAt.getTime();
        const deactivated = await provider.prices.deactivate({ id: a.id });
        expect(deactivated).not.toBeNull();
        const u = deactivated as ProviderPrice;
        expectIsPrice(u);
        await harness.assertConsistency?.price?.(u);
        expect(u.id).toBe(a.id);
        expect(u.active).toBe(false);
        expect(u.productId).toBe(a.productId);
        expect(u.currency).toBe(a.currency);
        expect(u.kind).toBe(a.kind);
        if (u.kind === 'recurring' && a.kind === 'recurring') {
          expect(u.unitAmount).toBe(a.unitAmount);
          expect(u.interval).toBe(a.interval);
          expect(u.intervalCount).toBe(a.intervalCount);
        }
        expect(u.updatedAt.getTime()).toBeGreaterThanOrEqual(before);
      });

      it('update silently strips `active` (use deactivate / activate instead)', async () => {
        const a = await provider.prices.create({
          productId: fixtureProduct.id,
          currency: 'usd',
          kind: 'one_time',
          unitAmount: 100,
        });
        trackPrice(a.id);
        await harness.assertConsistency?.price?.(a);
        // `active` is not part of the update input schema. Zod strips it.
        const u = await provider.prices.update({ id: a.id, active: false } as any);
        expectIsPrice(u);
        await harness.assertConsistency?.price?.(u);
        expect(u.id).toBe(a.id);
        expect(u.active).toBe(true);
      });

      it('update({id, metadata}) replaces metadata; no __provider_* keys leaked', async () => {
        const a = await provider.prices.create({
          productId: fixtureProduct.id,
          currency: 'usd',
          kind: 'one_time',
          unitAmount: 100,
        });
        trackPrice(a.id);
        await harness.assertConsistency?.price?.(a);
        const metadata = { plan: 'pro', region: 'us' };
        const u = await provider.prices.update({ id: a.id, metadata });
        expectIsPrice(u);
        await harness.assertConsistency?.price?.(u);
        expect(u.metadata).toEqual(metadata);
        for (const k of Object.keys(u.metadata)) {
          expect(k.startsWith('__provider_')).toBe(false);
        }
      });

      it('update({id, quantity:{min:2,max:5}}) round-trips on update + get', async () => {
        const a = await provider.prices.create({
          productId: fixtureProduct.id,
          currency: 'usd',
          kind: 'one_time',
          unitAmount: 100,
        });
        trackPrice(a.id);
        await harness.assertConsistency?.price?.(a);
        const u = await provider.prices.update({ id: a.id, quantity: { min: 2, max: 5 } });
        expectIsPrice(u);
        await harness.assertConsistency?.price?.(u);
        expect(u.quantity).toEqual({ min: 2, max: 5 });
        const got = await provider.prices.get({ id: a.id });
        expect(got).not.toBeNull();
        expect((got as ProviderPrice).quantity).toEqual({ min: 2, max: 5 });
      });

      // ---- validation: id ----
      it.each([
        ['missing', {}],
        ['empty', { id: '' }],
        ['number', { id: 42 as any }],
      ])('rejects invalid id (%s)', async (_l, input) => {
        await expect(provider.prices.update(input as any)).rejects.toBeInstanceOf(
          ProviderValidationError,
        );
      });

      // ---- validation: input shape ----
      it.each([
        ['null', null],
        ['undefined', undefined],
        ['empty object', {}],
      ])('rejects invalid input (%s)', async (_l, value) => {
        await expect(provider.prices.update(value as any)).rejects.toBeInstanceOf(
          ProviderValidationError,
        );
      });

      // ---- validation: metadata ----
      it('rejects non-object metadata on update', async () => {
        await expect(
          provider.prices.update({ id: 'price_x', metadata: 'not-obj' as any }),
        ).rejects.toBeInstanceOf(ProviderValidationError);
      });

      it.each([
        ['number value', { x: 1 }],
        ['null value', { k: null }],
      ])('rejects metadata with non-string values on update (%s)', async (_l, metadata) => {
        await expect(
          provider.prices.update({ id: 'price_x', metadata: metadata as any }),
        ).rejects.toBeInstanceOf(ProviderValidationError);
      });

      // ---- validation: quantity ----
      it.each([
        ['min=0', { min: 0 }],
        ['min=-1', { min: -1 }],
        ['min fractional', { min: 1.5 }],
        ['max<min', { min: 5, max: 2 }],
        ['max=0', { min: 1, max: 0 }],
        ['missing min', {}],
      ])('rejects invalid quantity on update (%s)', async (_l, value) => {
        await expect(
          provider.prices.update({ id: 'price_x', quantity: value as any }),
        ).rejects.toBeInstanceOf(ProviderValidationError);
      });

      // ---- collision ----
      it('throws MetadataCollisionError (422) for __provider_ keys', async () => {
        const a = await provider.prices.create({
          productId: fixtureProduct.id,
          currency: 'usd',
          kind: 'one_time',
          unitAmount: 100,
        });
        trackPrice(a.id);
        await harness.assertConsistency?.price?.(a);
        const err = await provider.prices
          .update({ id: a.id, metadata: { __provider_x: 'y' } as any })
          .then(
            () => null,
            (e: unknown) => e,
          );
        expect(err).toBeInstanceOf(MetadataCollisionError);
        expect((err as MetadataCollisionError).status).toBe(422);
      });

      // ---- immutable fields ----
      // For each immutable field, an update attempt must either reject with a
      // validation/constraint error, OR succeed without changing the field.
      // Adapters must never silently swap the price.
      it.each([
        ['currency', 'eur'],
        ['kind', 'recurring'],
        ['unitAmount', 4242],
        ['interval', 'year'],
        ['intervalCount', 7],
        ['productId', 'prod_something_else'],
      ])('does not silently mutate immutable field %s', async (field, badValue) => {
        const a = await provider.prices.create({
          productId: fixtureProduct.id,
          currency: 'usd',
          kind: 'recurring',
          unitAmount: 1500,
          interval: 'month',
          intervalCount: 1,
        });
        trackPrice(a.id);
        await harness.assertConsistency?.price?.(a);

        let outcome: { kind: 'thrown'; err: unknown } | { kind: 'ok'; p: ProviderPrice };
        try {
          const p = await provider.prices.update({ id: a.id, [field]: badValue } as any);
          outcome = { kind: 'ok', p };
        } catch (err) {
          outcome = { kind: 'thrown', err };
        }

        if (outcome.kind === 'thrown') {
          const e = outcome.err;
          expect(e instanceof ProviderValidationError || e instanceof ProviderConstraintError).toBe(
            true,
          );
          if (e instanceof ProviderValidationError) {
            expect(e.status).toBe(400);
          } else if (e instanceof ProviderConstraintError) {
            expect(e.status).toBe(422);
          }
          // Make sure the original value is intact.
          const stillThere = await provider.prices.get({ id: a.id });
          expect(stillThere).not.toBeNull();
          const rec = stillThere as ProviderPrice;
          expect(rec.id).toBe(a.id);
          expect(rec.productId).toBe(a.productId);
          expect(rec.currency).toBe(a.currency);
          expect(rec.kind).toBe(a.kind);
          if (rec.kind === 'recurring' && a.kind === 'recurring') {
            expect(rec.unitAmount).toBe(a.unitAmount);
            expect(rec.interval).toBe(a.interval);
            expect(rec.intervalCount).toBe(a.intervalCount);
          }
        } else {
          const p = outcome.p;
          await harness.assertConsistency?.price?.(p);
          // Same id (no silent swap).
          expect(p.id).toBe(a.id);
          // Immutable values unchanged on both the returned record and a get.
          expect(p.productId).toBe(a.productId);
          expect(p.currency).toBe(a.currency);
          expect(p.kind).toBe(a.kind);
          if (p.kind === 'recurring' && a.kind === 'recurring') {
            expect(p.unitAmount).toBe(a.unitAmount);
            expect(p.interval).toBe(a.interval);
            expect(p.intervalCount).toBe(a.intervalCount);
          }
          const got = await provider.prices.get({ id: a.id });
          expect(got).not.toBeNull();
          const rec = got as ProviderPrice;
          expect(rec.productId).toBe(a.productId);
          expect(rec.currency).toBe(a.currency);
          expect(rec.kind).toBe(a.kind);
          if (rec.kind === 'recurring' && a.kind === 'recurring') {
            expect(rec.unitAmount).toBe(a.unitAmount);
            expect(rec.interval).toBe(a.interval);
            expect(rec.intervalCount).toBe(a.intervalCount);
          }
        }
      });

      // ---- provider-mapped ----
      it('throws ProviderNotFoundError (404) for a missing id', async () => {
        const err = await provider.prices
          .update({
            id: 'price_definitely_does_not_exist_xyz_999',
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
    // prices.deactivate
    // -------------------------------------------------------------------------
    describe('prices.deactivate', () => {
      it('deactivates a price; returns record with active=false; immutable fields unchanged', async () => {
        const localProduct = await provider.products.create({
          name: 'fixture-deactivate',
          taxCategory: 'saas',
        });
        trackProduct(localProduct.id);
        await harness.assertConsistency?.product?.(localProduct);

        const a = await provider.prices.create({
          productId: localProduct.id,
          currency: 'usd',
          kind: 'recurring',
          unitAmount: 500,
          interval: 'month',
          intervalCount: 1,
        });
        trackPrice(a.id);
        await harness.assertConsistency?.price?.(a);

        const archived = await provider.prices.deactivate({ id: a.id });
        expect(archived).not.toBeNull();
        expectIsPrice(archived as ProviderPrice);
        await harness.assertConsistency?.price?.(archived as ProviderPrice);
        const rec = archived as ProviderPrice;
        expect(rec.id).toBe(a.id);
        expect(rec.active).toBe(false);
        expect(rec.productId).toBe(a.productId);
        expect(rec.currency).toBe(a.currency);
        expect(rec.kind).toBe(a.kind);
        if (rec.kind === 'recurring' && a.kind === 'recurring') {
          expect(rec.unitAmount).toBe(a.unitAmount);
          expect(rec.interval).toBe(a.interval);
          expect(rec.intervalCount).toBe(a.intervalCount);
        }

        const got = await provider.prices.get({ id: a.id });
        expect(got).not.toBeNull();
        expect((got as ProviderPrice).active).toBe(false);

        const activeList = await provider.prices.list({
          productId: localProduct.id,
          active: true,
        });
        expectIsPage<ProviderPrice>(activeList);
        expect(activeList.data.some((p) => p.id === a.id)).toBe(false);

        const inactiveList = await provider.prices.list({
          productId: localProduct.id,
          active: false,
        });
        expectIsPage<ProviderPrice>(inactiveList);
        expect(inactiveList.data.some((p) => p.id === a.id)).toBe(true);
      });

      it('returns null for a missing id', async () => {
        const out = await provider.prices.deactivate({
          id: 'price_definitely_missing_xyz_777',
        });
        expect(out).toBeNull();
      });

      it('is idempotent — a double deactivate does not throw', async () => {
        const a = await provider.prices.create({
          productId: fixtureProduct.id,
          currency: 'usd',
          kind: 'one_time',
          unitAmount: 100,
        });
        trackPrice(a.id);
        await harness.assertConsistency?.price?.(a);
        const first = await provider.prices.deactivate({ id: a.id });
        if (first !== null) {
          await harness.assertConsistency?.price?.(first);
        }
        let second: ProviderPrice | null = null;
        await expect(
          (async () => {
            second = await provider.prices.deactivate({ id: a.id });
          })(),
        ).resolves.not.toThrow();
        if (second !== null) {
          expect((second as ProviderPrice).id).toBe(a.id);
          expect((second as ProviderPrice).active).toBe(false);
          await harness.assertConsistency?.price?.(second);
        }
      });

      // ---- validation: id ----
      it.each([
        ['missing', {}],
        ['empty', { id: '' }],
        ['number', { id: 42 as any }],
      ])('rejects invalid id (%s)', async (_l, input) => {
        await expect(provider.prices.deactivate(input as any)).rejects.toBeInstanceOf(
          ProviderValidationError,
        );
      });

      // ---- validation: input shape ----
      it.each([
        ['null', null],
        ['empty object', {}],
      ])('rejects invalid input (%s)', async (_l, value) => {
        await expect(provider.prices.deactivate(value as any)).rejects.toBeInstanceOf(
          ProviderValidationError,
        );
      });
    });

    // -------------------------------------------------------------------------
    // prices.activate
    // -------------------------------------------------------------------------
    describe('prices.activate', () => {
      it('activates a deactivated price; immutable fields preserved', async () => {
        const a = await provider.prices.create({
          productId: fixtureProduct.id,
          currency: 'usd',
          kind: 'recurring',
          unitAmount: 750,
          interval: 'month',
          intervalCount: 1,
        });
        trackPrice(a.id);
        await harness.assertConsistency?.price?.(a);
        const deactivated = await provider.prices.deactivate({ id: a.id });
        if (deactivated !== null) {
          await harness.assertConsistency?.price?.(deactivated);
        }

        const activated = await provider.prices.activate({ id: a.id });
        expect(activated).not.toBeNull();
        const rec = activated as ProviderPrice;
        expectIsPrice(rec);
        await harness.assertConsistency?.price?.(rec);
        expect(rec.id).toBe(a.id);
        expect(rec.active).toBe(true);
        expect(rec.productId).toBe(a.productId);
        expect(rec.currency).toBe(a.currency);
        expect(rec.kind).toBe(a.kind);
        if (rec.kind === 'recurring' && a.kind === 'recurring') {
          expect(rec.unitAmount).toBe(a.unitAmount);
          expect(rec.interval).toBe(a.interval);
          expect(rec.intervalCount).toBe(a.intervalCount);
        }
      });

      it('returns null for a missing id', async () => {
        const out = await provider.prices.activate({
          id: 'price_definitely_missing_xyz_888',
        });
        expect(out).toBeNull();
      });

      it('is idempotent — activating an already-active price does not throw', async () => {
        const a = await provider.prices.create({
          productId: fixtureProduct.id,
          currency: 'usd',
          kind: 'one_time',
          unitAmount: 100,
        });
        trackPrice(a.id);
        await harness.assertConsistency?.price?.(a);
        let result: ProviderPrice | null = null;
        await expect(
          (async () => {
            result = await provider.prices.activate({ id: a.id });
          })(),
        ).resolves.not.toThrow();
        if (result !== null) {
          expect((result as ProviderPrice).id).toBe(a.id);
          expect((result as ProviderPrice).active).toBe(true);
          await harness.assertConsistency?.price?.(result);
        }
      });

      // ---- validation: id ----
      it.each([
        ['missing', {}],
        ['empty', { id: '' }],
        ['number', { id: 42 as any }],
      ])('rejects invalid id (%s)', async (_l, input) => {
        await expect(provider.prices.activate(input as any)).rejects.toBeInstanceOf(
          ProviderValidationError,
        );
      });

      // ---- validation: input shape ----
      it.each([
        ['null', null],
        ['empty object', {}],
      ])('rejects invalid input (%s)', async (_l, value) => {
        await expect(provider.prices.activate(value as any)).rejects.toBeInstanceOf(
          ProviderValidationError,
        );
      });
    });

    // -------------------------------------------------------------------------
    // Best-effort cleanup
    // -------------------------------------------------------------------------
    afterAll(async () => {
      for (const id of createdPriceIds) {
        try {
          await provider.prices.deactivate({ id });
        } catch {
          // Ignore cleanup failures.
        }
      }
      for (const id of createdProductIds) {
        try {
          await provider.products.deactivate({ id });
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
