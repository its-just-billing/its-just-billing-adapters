import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  MetadataCollisionError,
  ProviderNotFoundError,
  ProviderValidationError,
} from '../../../errors/index.js';
import type { BillingProvider, ProviderProduct } from '../../../index.js';
import { withoutRaw } from '../../equality.js';
import type { ProviderTestHarness } from '../../harness.js';
import { nonNull } from '../../skip-if.js';

/**
 * Registers the products automated conformance suite. All scenarios in the
 * products brief are encoded here; this file is the spec, the brief is the
 * source of truth.
 */
export function registerProductsAutomatedSuite(
  label: string,
  factory: () => ProviderTestHarness | Promise<ProviderTestHarness>,
): void {
  // ---------------------------------------------------------------------------
  // Helpers (intentionally inlined per the task instructions — no shared util
  // library yet).
  // ---------------------------------------------------------------------------

  function uniqueName(prefix = 'test-prod'): string {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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

  /**
   * The full set of allowed values for the read-side `taxCategory` field on
   * a `ProviderProduct`. Mirrors the union of `TaxCategory` ∪ `'other'` ∪
   * `null` (see `TaxCategoryOutputSchema` in the SDK).
   */
  const TAX_CATEGORY_OUTPUT_VALUES = new Set<string>([
    'digital_goods',
    'ebooks',
    'implementation_services',
    'professional_services',
    'saas',
    'software_programming_services',
    'standard',
    'training_services',
    'website_hosting',
    'other',
  ]);

  function expectIsProduct(p: unknown): asserts p is ProviderProduct {
    expect(isPlainObject(p)).toBe(true);
    const rec = p as Record<string, unknown>;

    expect(typeof rec.id).toBe('string');
    expect((rec.id as string).length).toBeGreaterThan(0);

    expect(typeof rec.name).toBe('string');
    expect((rec.name as string).length).toBeGreaterThan(0);

    expect(rec.description === null || typeof rec.description === 'string').toBe(true);
    expect(typeof rec.active).toBe('boolean');

    // taxCategory must be present (own key) and either null or one of the
    // 9 TaxCategory enum strings OR the read-side fallback 'other'.
    expect(Object.prototype.hasOwnProperty.call(rec, 'taxCategory')).toBe(true);
    const tc = rec.taxCategory;
    expect(tc === null || (typeof tc === 'string' && TAX_CATEGORY_OUTPUT_VALUES.has(tc))).toBe(
      true,
    );

    expect(isPlainObject(rec.metadata)).toBe(true);
    for (const [k, v] of Object.entries(rec.metadata as Record<string, unknown>)) {
      expect(typeof v).toBe('string');
      // Reserved keys must never appear on returned metadata.
      expect(k.startsWith('__provider_')).toBe(false);
    }

    expect(rec.createdAt).toBeInstanceOf(Date);
    expect(Number.isFinite((rec.createdAt as Date).getTime())).toBe(true);

    expect(rec.updatedAt).toBeInstanceOf(Date);
    expect(Number.isFinite((rec.updatedAt as Date).getTime())).toBe(true);

    // updatedAt >= createdAt invariant.
    expect((rec.updatedAt as Date).getTime()).toBeGreaterThanOrEqual(
      (rec.createdAt as Date).getTime(),
    );
  }

  function expectCreatedAtRecent(p: ProviderProduct): void {
    const now = Date.now();
    const fiveMinutes = 5 * 60 * 1000;
    const ts = p.createdAt.getTime();
    expect(ts).toBeGreaterThanOrEqual(now - fiveMinutes);
    expect(ts).toBeLessThanOrEqual(now + fiveMinutes);
  }

  // ---------------------------------------------------------------------------
  // Outer describe — acquires harness once, registers per-method describes.
  // ---------------------------------------------------------------------------

  describe(`products [${label}]`, () => {
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
    // products.create
    // -------------------------------------------------------------------------
    describe('products.create', () => {
      it('returns a ProviderProduct with sensible defaults for create({name})', async () => {
        const name = uniqueName();
        const p = await provider.products.create({ name, taxCategory: 'saas' });
        track(p.id);
        expectIsProduct(p);
        await harness.assertConsistency?.product?.(p);
        expect(p.name).toBe(name);
        expect(p.description).toBeNull();
        expect(p.active).toBe(true);
        expect(p.metadata).toEqual({});
        expectCreatedAtRecent(p);
        expect(p.updatedAt.getTime()).toBeGreaterThanOrEqual(p.createdAt.getTime());
      });

      it('round-trips name/description/metadata on create; active defaults to true', async () => {
        const name = uniqueName();
        const description = 'A product for round-trip testing.';
        const metadata = { plan: 'pro', source: 'signup' };
        const p = await provider.products.create({
          name,
          taxCategory: 'saas',
          description,
          metadata,
        });
        track(p.id);
        expectIsProduct(p);
        await harness.assertConsistency?.product?.(p);
        expect(p.name).toBe(name);
        expect(p.description).toBe(description);
        expect(p.active).toBe(true);
        expect(p.metadata).toEqual(metadata);
        expectCreatedAtRecent(p);
      });

      it('silently strips `active` when supplied to create (defaults to true)', async () => {
        const name = uniqueName();
        // `active` is not part of the create input schema. Zod strips unknown
        // keys by default, so the call succeeds and the resource is active.
        const p = await provider.products.create({
          name,
          taxCategory: 'saas',
          active: false,
        } as any);
        track(p.id);
        expectIsProduct(p);
        await harness.assertConsistency?.product?.(p);
        expect(p.active).toBe(true);
      });

      it('accepts null description explicitly', async () => {
        const name = uniqueName();
        const p = await provider.products.create({
          name,
          taxCategory: 'saas',
          description: null,
        });
        track(p.id);
        expectIsProduct(p);
        await harness.assertConsistency?.product?.(p);
        expect(p.description).toBeNull();
      });

      it('rejects empty-string description', async () => {
        // Empty string is not a meaningful description and Stripe rejects it
        // outright (description "cannot be unset"). The SDK contract treats
        // description as omit-or-non-empty.
        await expect(
          provider.products.create({
            name: uniqueName(),
            taxCategory: 'saas',
            description: '',
          }),
        ).rejects.toBeInstanceOf(ProviderValidationError);
      });

      it('two creates with the same name produce distinct ids', async () => {
        const name = uniqueName();
        const a = await provider.products.create({ name, taxCategory: 'saas' });
        const b = await provider.products.create({ name, taxCategory: 'saas' });
        track(a.id);
        track(b.id);
        await harness.assertConsistency?.product?.(a);
        await harness.assertConsistency?.product?.(b);
        expect(a.id).not.toBe(b.id);
      });

      // ---- happy path: taxCategory round-trip ----
      it('round-trips taxCategory:"saas" on create and via subsequent get', async () => {
        const name = uniqueName();
        const created = await provider.products.create({ name, taxCategory: 'saas' });
        track(created.id);
        expectIsProduct(created);
        await harness.assertConsistency?.product?.(created);
        expect(created.taxCategory).toBe('saas');
        const got = await provider.products.get({ id: created.id });
        expect(got).not.toBeNull();
        expectIsProduct(got);
        expect((got as ProviderProduct).taxCategory).toBe('saas');
      });

      it('round-trips a non-default taxCategory ("ebooks") on create', async () => {
        const name = uniqueName();
        const created = await provider.products.create({ name, taxCategory: 'ebooks' });
        track(created.id);
        expectIsProduct(created);
        await harness.assertConsistency?.product?.(created);
        expect(created.taxCategory).toBe('ebooks');
      });

      // ---- validation: input shape ----
      it.each([
        ['undefined', undefined],
        ['null', null],
        ['string', 'foo'],
        ['number', 42],
        ['boolean', true],
      ])('rejects non-object input (%s)', async (_label, value) => {
        await expect(provider.products.create(value as any)).rejects.toBeInstanceOf(
          ProviderValidationError,
        );
      });

      // ---- validation: name ----
      it.each([
        ['missing', {}],
        ['empty string', { name: '' }],
        ['null', { name: null as any }],
        ['number', { name: 123 as any }],
        ['undefined', { name: undefined as any }],
      ])('rejects invalid name (%s)', async (_label, input) => {
        await expect(provider.products.create(input as any)).rejects.toBeInstanceOf(
          ProviderValidationError,
        );
      });

      // ---- validation: description ----
      it.each([
        ['number', 123],
        ['object', {}],
        ['boolean', false],
      ])('rejects invalid description (%s)', async (_label, value) => {
        await expect(
          provider.products.create({
            name: uniqueName(),
            taxCategory: 'saas',
            description: value as any,
          }),
        ).rejects.toBeInstanceOf(ProviderValidationError);
      });

      // ---- validation: metadata shape & values ----
      it.each([
        ['string', 'foo'],
        ['array', ['a']],
        ['null', null],
      ])('rejects non-object metadata (%s)', async (_label, value) => {
        await expect(
          provider.products.create({
            name: uniqueName(),
            taxCategory: 'saas',
            metadata: value as any,
          }),
        ).rejects.toBeInstanceOf(ProviderValidationError);
      });

      it.each([
        ['number value', { count: 1 as any }],
        ['nested object value', { nested: { a: 'b' } as any }],
        ['null value', { key: null as any }],
      ])('rejects metadata with non-string values (%s)', async (_label, metadata) => {
        await expect(
          provider.products.create({
            name: uniqueName(),
            taxCategory: 'saas',
            metadata: metadata as any,
          }),
        ).rejects.toBeInstanceOf(ProviderValidationError);
      });

      it('throws MetadataCollisionError (422) for reserved __provider_ keys', async () => {
        const err = await provider.products
          .create({
            name: uniqueName(),
            taxCategory: 'saas',
            metadata: { __provider_secret: 'x' } as any,
          })
          .then(
            () => null,
            (e: unknown) => e,
          );
        expect(err).toBeInstanceOf(MetadataCollisionError);
        expect((err as MetadataCollisionError).status).toBe(422);
        expect(Array.isArray((err as MetadataCollisionError).reservedKeys)).toBe(true);
        expect((err as MetadataCollisionError).reservedKeys).toContain('__provider_secret');
      });

      it('throws MetadataCollisionError when reserved keys mixed with valid ones', async () => {
        const err = await provider.products
          .create({
            name: uniqueName(),
            taxCategory: 'saas',
            metadata: { plan: 'gold', __provider_internal: 'x' } as any,
          })
          .then(
            () => null,
            (e: unknown) => e,
          );
        expect(err).toBeInstanceOf(MetadataCollisionError);
        expect((err as MetadataCollisionError).reservedKeys).toContain('__provider_internal');
      });

      // ---- validation: taxCategory ----
      it('rejects missing taxCategory (400)', async () => {
        await expect(
          provider.products.create({ name: uniqueName() } as any),
        ).rejects.toBeInstanceOf(ProviderValidationError);
      });

      it('rejects invalid string taxCategory (400)', async () => {
        await expect(
          provider.products.create({
            name: uniqueName(),
            taxCategory: 'invalid_value' as any,
          }),
        ).rejects.toBeInstanceOf(ProviderValidationError);
      });

      it('rejects number taxCategory (400)', async () => {
        await expect(
          provider.products.create({
            name: uniqueName(),
            taxCategory: 42 as any,
          }),
        ).rejects.toBeInstanceOf(ProviderValidationError);
      });

      it('rejects null taxCategory (400)', async () => {
        await expect(
          provider.products.create({
            name: uniqueName(),
            taxCategory: null as any,
          }),
        ).rejects.toBeInstanceOf(ProviderValidationError);
      });
    });

    // -------------------------------------------------------------------------
    // products.get
    // -------------------------------------------------------------------------
    describe('products.get', () => {
      it('returns a deep-equal record for an existing id', async () => {
        const p = await provider.products.create({ name: uniqueName(), taxCategory: 'saas' });
        track(p.id);
        await harness.assertConsistency?.product?.(p);
        const got = await provider.products.get({ id: p.id });
        expect(withoutRaw(nonNull(got, 'got'))).toEqual(withoutRaw(p));
      });

      it('returns null (does not throw) for a missing id', async () => {
        const got = await provider.products.get({ id: 'prod_does_not_exist' });
        expect(got).toBeNull();
      });

      // ---- validation: input shape ----
      it.each([
        ['null', null],
        ['string', 'prod_x'],
        ['undefined', undefined],
      ])('rejects non-object input (%s)', async (_label, value) => {
        await expect(provider.products.get(value as any)).rejects.toBeInstanceOf(
          ProviderValidationError,
        );
      });

      // ---- validation: id field ----
      it.each([
        ['missing', {}],
        ['empty string', { id: '' }],
        ['null', { id: null as any }],
        ['number', { id: 42 as any }],
        ['object', { id: { x: 1 } as any }],
      ])('rejects invalid id (%s)', async (_label, input) => {
        await expect(provider.products.get(input as any)).rejects.toBeInstanceOf(
          ProviderValidationError,
        );
      });
    });

    // -------------------------------------------------------------------------
    // products.list
    // -------------------------------------------------------------------------
    describe('products.list', () => {
      it('returns an array (never null/undefined) with no input', async () => {
        const out = await provider.products.list();
        expectIsPage<ProviderProduct>(out);
        for (const p of out.data) expectIsProduct(p);
      });

      it('returns an array (never null/undefined) with empty input', async () => {
        const out = await provider.products.list({});
        expectIsPage<ProviderProduct>(out);
      });

      it('list({active:true}) includes both A and B after creating them', async () => {
        const a = await provider.products.create({ name: uniqueName(), taxCategory: 'saas' });
        const b = await provider.products.create({ name: uniqueName(), taxCategory: 'saas' });
        track(a.id);
        track(b.id);
        await harness.assertConsistency?.product?.(a);
        await harness.assertConsistency?.product?.(b);
        const out = await provider.products.list({ active: true, limit: 100 });
        expectIsPage<ProviderProduct>(out);
        const ids = new Set(out.data.map((p) => p.id));
        expect(ids.has(a.id)).toBe(true);
        expect(ids.has(b.id)).toBe(true);
        for (const p of out.data) {
          expectIsProduct(p);
          expect(p.active).toBe(true);
        }
      });

      it('after deactivate, list({active:false}) includes A and list({active:true}) excludes A', async () => {
        const a = await provider.products.create({ name: uniqueName(), taxCategory: 'saas' });
        track(a.id);
        await harness.assertConsistency?.product?.(a);
        const archived = await provider.products.deactivate({ id: a.id });
        expect(archived).not.toBeNull();
        if (archived !== null) {
          await harness.assertConsistency?.product?.(archived);
        }

        const inactive = await provider.products.list({ active: false, limit: 100 });
        expectIsPage<ProviderProduct>(inactive);
        const inactiveIds = new Set(inactive.data.map((p) => p.id));
        expect(inactiveIds.has(a.id)).toBe(true);
        for (const p of inactive.data) {
          expectIsProduct(p);
          expect(p.active).toBe(false);
        }

        const active = await provider.products.list({ active: true, limit: 100 });
        expectIsPage<ProviderProduct>(active);
        const activeIds = new Set(active.data.map((p) => p.id));
        expect(activeIds.has(a.id)).toBe(false);
      });

      it('caps result length when limit is supplied', async () => {
        // Ensure at least 2 products exist so the cap is meaningful.
        for (let i = 0; i < 2; i++) {
          const p = await provider.products.create({ name: uniqueName(), taxCategory: 'saas' });
          track(p.id);
          await harness.assertConsistency?.product?.(p);
        }
        const out = await provider.products.list({ limit: 1 });
        expectIsPage<ProviderProduct>(out);
        expect(out.data.length).toBeLessThanOrEqual(1);
      });

      // ---- validation: cursor ----
      it('rejects empty cursor', async () => {
        await expect(provider.products.list({ cursor: '' })).rejects.toBeInstanceOf(
          ProviderValidationError,
        );
      });

      it.each([
        ['number', 42],
        ['object', { x: 1 }],
        ['null', null],
      ])('rejects non-string cursor (%s)', async (_label, value) => {
        await expect(provider.products.list({ cursor: value as any })).rejects.toBeInstanceOf(
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
        ['null', null],
      ])('rejects invalid limit (%s)', async (_label, value) => {
        await expect(provider.products.list({ limit: value as any })).rejects.toBeInstanceOf(
          ProviderValidationError,
        );
      });

      // ---- validation: active ----
      it.each([
        ['string "true"', 'true'],
        ['number 1', 1],
        ['null', null],
      ])('rejects non-boolean active (%s)', async (_label, value) => {
        await expect(provider.products.list({ active: value as any })).rejects.toBeInstanceOf(
          ProviderValidationError,
        );
      });
    });

    // -------------------------------------------------------------------------
    // products.update
    // -------------------------------------------------------------------------
    describe('products.update', () => {
      it('renames product, preserves description/active/metadata/createdAt, bumps updatedAt', async () => {
        const original = await provider.products.create({
          name: uniqueName(),
          taxCategory: 'saas',
          description: 'Original description',
          metadata: { plan: 'silver' },
        });
        track(original.id);
        await harness.assertConsistency?.product?.(original);

        const renamed = `${original.name}-renamed`;
        const u = await provider.products.update({ id: original.id, name: renamed });
        expectIsProduct(u);
        await harness.assertConsistency?.product?.(u);
        expect(u.id).toBe(original.id);
        expect(u.name).toBe(renamed);
        expect(u.description).toBe('Original description');
        expect(u.active).toBe(true);
        expect(u.metadata).toEqual({ plan: 'silver' });
        expect(u.createdAt.getTime()).toBe(original.createdAt.getTime());
        expect(u.updatedAt.getTime()).toBeGreaterThanOrEqual(original.updatedAt.getTime());
      });

      it('rejects update({id, description: null}) — description cannot be cleared', async () => {
        // The SDK contract: once set, description cannot be unset. Pass a new
        // non-empty string to change it, or omit the field to keep the current
        // value. Empty string and null are both rejected at validation. This
        // mirrors Stripe's "description cannot be unset" constraint.
        const p = await provider.products.create({
          name: uniqueName(),
          taxCategory: 'saas',
          description: 'cannot be unset',
        });
        track(p.id);
        await harness.assertConsistency?.product?.(p);
        await expect(
          provider.products.update({ id: p.id, description: null } as any),
        ).rejects.toBeInstanceOf(ProviderValidationError);
        await expect(
          provider.products.update({ id: p.id, description: '' } as any),
        ).rejects.toBeInstanceOf(ProviderValidationError);
      });

      it('update silently strips `active` (use deactivate / activate instead)', async () => {
        const p = await provider.products.create({ name: uniqueName(), taxCategory: 'saas' });
        track(p.id);
        await harness.assertConsistency?.product?.(p);
        // `active` is not part of the update input schema. Zod strips it, so
        // the call succeeds and the resource remains active.
        const u = await provider.products.update({ id: p.id, active: false } as any);
        expectIsProduct(u);
        await harness.assertConsistency?.product?.(u);
        expect(u.active).toBe(true);
        expect(u.id).toBe(p.id);
        expect(u.createdAt.getTime()).toBe(p.createdAt.getTime());
        expect(u.updatedAt.getTime()).toBeGreaterThanOrEqual(p.updatedAt.getTime());
      });

      it('update({id, metadata}) REPLACES caller-visible metadata', async () => {
        const p = await provider.products.create({
          name: uniqueName(),
          taxCategory: 'saas',
          metadata: { keep: 'no', also: 'no' },
        });
        track(p.id);
        await harness.assertConsistency?.product?.(p);
        const u = await provider.products.update({
          id: p.id,
          metadata: { plan: 'gold' },
        });
        expectIsProduct(u);
        await harness.assertConsistency?.product?.(u);
        expect(u.metadata.plan).toBe('gold');
      });

      it('update({id}) is a valid no-op and returns equivalent record', async () => {
        const p = await provider.products.create({
          name: uniqueName(),
          taxCategory: 'saas',
          description: 'noop',
          metadata: { a: '1' },
        });
        track(p.id);
        await harness.assertConsistency?.product?.(p);
        const u = await provider.products.update({ id: p.id });
        expectIsProduct(u);
        await harness.assertConsistency?.product?.(u);
        expect(u.id).toBe(p.id);
        expect(u.name).toBe(p.name);
        expect(u.description).toBe(p.description);
        expect(u.active).toBe(p.active);
        expect(u.metadata).toEqual(p.metadata);
        expect(u.createdAt.getTime()).toBe(p.createdAt.getTime());
        expect(u.updatedAt.getTime()).toBeGreaterThanOrEqual(p.updatedAt.getTime());
      });

      it('throws ProviderNotFoundError (404) for a missing id', async () => {
        const err = await provider.products
          .update({ id: 'prod_definitely_does_not_exist_xyz_999', name: 'Ghost' })
          .then(
            () => null,
            (e: unknown) => e,
          );
        expect(err).toBeInstanceOf(ProviderNotFoundError);
        expect((err as ProviderNotFoundError).status).toBe(404);
      });

      it('throws MetadataCollisionError (422) BEFORE provider call for reserved keys', async () => {
        // Use a non-existent id; collision check must precede the provider lookup.
        const err = await provider.products
          .update({
            id: 'prod_definitely_does_not_exist_xyz_collision',
            metadata: { __provider_x: 'y' } as any,
          })
          .then(
            () => null,
            (e: unknown) => e,
          );
        expect(err).toBeInstanceOf(MetadataCollisionError);
        expect((err as MetadataCollisionError).status).toBe(422);
        expect((err as MetadataCollisionError).reservedKeys).toContain('__provider_x');
      });

      // ---- validation: id ----
      it.each([
        ['missing', {}],
        ['empty', { id: '' }],
        ['null', { id: null as any }],
        ['number', { id: 123 as any }],
      ])('rejects invalid id (%s)', async (_label, input) => {
        await expect(provider.products.update(input as any)).rejects.toBeInstanceOf(
          ProviderValidationError,
        );
      });

      // ---- validation: input shape ----
      it.each([
        ['null', null],
        ['undefined', undefined],
        ['string', 'prod_x'],
        ['number', 42],
      ])('rejects non-object input (%s)', async (_label, value) => {
        await expect(provider.products.update(value as any)).rejects.toBeInstanceOf(
          ProviderValidationError,
        );
      });

      // ---- validation: name on update ----
      it.each([
        ['empty', ''],
        ['null', null],
        ['number', 42],
      ])('rejects invalid name on update (%s)', async (_label, value) => {
        await expect(
          provider.products.update({ id: 'prod_x', name: value as any }),
        ).rejects.toBeInstanceOf(ProviderValidationError);
      });

      // ---- validation: description on update ----
      it.each([
        ['number', 123],
        ['object', {}],
        ['boolean', false],
      ])('rejects invalid description on update (%s)', async (_label, value) => {
        await expect(
          provider.products.update({ id: 'prod_x', description: value as any }),
        ).rejects.toBeInstanceOf(ProviderValidationError);
      });

      // ---- validation: metadata on update ----
      it.each([
        ['string', 'x'],
        ['array', []],
        ['null', null],
      ])('rejects non-object metadata on update (%s)', async (_label, value) => {
        await expect(
          provider.products.update({ id: 'prod_x', metadata: value as any }),
        ).rejects.toBeInstanceOf(ProviderValidationError);
      });

      it.each([
        ['number value', { n: 1 as any }],
        ['null value', { k: null as any }],
      ])('rejects metadata with non-string values on update (%s)', async (_label, metadata) => {
        await expect(
          provider.products.update({ id: 'prod_x', metadata: metadata as any }),
        ).rejects.toBeInstanceOf(ProviderValidationError);
      });
    });

    // -------------------------------------------------------------------------
    // products.deactivate
    // -------------------------------------------------------------------------
    describe('products.deactivate', () => {
      it('deactivates an existing product and preserves identity/fields', async () => {
        const created = await provider.products.create({
          name: uniqueName(),
          taxCategory: 'saas',
          description: 'to deactivate',
          metadata: { tier: 'pro' },
        });
        track(created.id);
        await harness.assertConsistency?.product?.(created);

        const archived = await provider.products.deactivate({ id: created.id });
        expect(archived).not.toBeNull();
        const a = archived as ProviderProduct;
        expectIsProduct(a);
        await harness.assertConsistency?.product?.(a);
        expect(a.id).toBe(created.id);
        expect(a.active).toBe(false);
        expect(a.name).toBe(created.name);
        expect(a.description).toBe(created.description);
        expect(a.metadata).toEqual(created.metadata);
        expect(a.createdAt.getTime()).toBe(created.createdAt.getTime());
        expect(a.updatedAt.getTime()).toBeGreaterThanOrEqual(created.updatedAt.getTime());
      });

      it('after deactivate: get(id) still returns the record (not null) with active=false', async () => {
        const p = await provider.products.create({ name: uniqueName(), taxCategory: 'saas' });
        track(p.id);
        await harness.assertConsistency?.product?.(p);
        const d = await provider.products.deactivate({ id: p.id });
        if (d !== null) {
          await harness.assertConsistency?.product?.(d);
        }
        const got = await provider.products.get({ id: p.id });
        expect(got).not.toBeNull();
        const g = got as ProviderProduct;
        expectIsProduct(g);
        expect(g.id).toBe(p.id);
        expect(g.active).toBe(false);
      });

      it('after deactivate: list({active:false}) includes; list({active:true}) excludes', async () => {
        const p = await provider.products.create({ name: uniqueName(), taxCategory: 'saas' });
        track(p.id);
        await harness.assertConsistency?.product?.(p);
        const d = await provider.products.deactivate({ id: p.id });
        if (d !== null) {
          await harness.assertConsistency?.product?.(d);
        }

        const inactive = await provider.products.list({ active: false, limit: 100 });
        expectIsPage<ProviderProduct>(inactive);
        const inactiveIds = new Set(inactive.data.map((r) => r.id));
        expect(inactiveIds.has(p.id)).toBe(true);

        const active = await provider.products.list({ active: true, limit: 100 });
        expectIsPage<ProviderProduct>(active);
        const activeIds = new Set(active.data.map((r) => r.id));
        expect(activeIds.has(p.id)).toBe(false);
      });

      it('returns null (does not throw) for a missing id', async () => {
        const out = await provider.products.deactivate({ id: 'prod_does_not_exist' });
        expect(out).toBeNull();
      });

      it('double-deactivate does not throw; returns null OR record with active=false', async () => {
        const p = await provider.products.create({ name: uniqueName(), taxCategory: 'saas' });
        track(p.id);
        await harness.assertConsistency?.product?.(p);
        const first = await provider.products.deactivate({ id: p.id });
        if (first !== null) {
          await harness.assertConsistency?.product?.(first);
        }

        let second: ProviderProduct | null = null;
        await expect(
          (async () => {
            second = await provider.products.deactivate({ id: p.id });
          })(),
        ).resolves.not.toThrow();
        if (second !== null) {
          const s = second as ProviderProduct;
          expectIsProduct(s);
          await harness.assertConsistency?.product?.(s);
          expect(s.id).toBe(p.id);
          expect(s.active).toBe(false);
        }
      });

      // ---- validation: input shape ----
      it.each([
        ['null', null],
        ['undefined', undefined],
        ['string', 'prod_x'],
        ['number', 42],
      ])('rejects non-object input (%s)', async (_label, value) => {
        await expect(provider.products.deactivate(value as any)).rejects.toBeInstanceOf(
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
        await expect(provider.products.deactivate(input as any)).rejects.toBeInstanceOf(
          ProviderValidationError,
        );
      });
    });

    // -------------------------------------------------------------------------
    // products.activate
    // -------------------------------------------------------------------------
    describe('products.activate', () => {
      it('activates a previously deactivated product; immutable fields preserved', async () => {
        const created = await provider.products.create({
          name: uniqueName(),
          taxCategory: 'saas',
          description: 'to deactivate then activate',
          metadata: { tier: 'pro' },
        });
        track(created.id);
        await harness.assertConsistency?.product?.(created);

        const deactivated = await provider.products.deactivate({ id: created.id });
        expect(deactivated).not.toBeNull();
        expect((deactivated as ProviderProduct).active).toBe(false);
        await harness.assertConsistency?.product?.(deactivated as ProviderProduct);

        const activated = await provider.products.activate({ id: created.id });
        expect(activated).not.toBeNull();
        const a = activated as ProviderProduct;
        expectIsProduct(a);
        await harness.assertConsistency?.product?.(a);
        expect(a.id).toBe(created.id);
        expect(a.active).toBe(true);
        expect(a.name).toBe(created.name);
        expect(a.description).toBe(created.description);
        expect(a.metadata).toEqual(created.metadata);
        expect(a.createdAt.getTime()).toBe(created.createdAt.getTime());
      });

      it('returns null (does not throw) for a missing id', async () => {
        const out = await provider.products.activate({ id: 'prod_does_not_exist' });
        expect(out).toBeNull();
      });

      it('activating an already-active product does not throw (idempotent)', async () => {
        const p = await provider.products.create({ name: uniqueName(), taxCategory: 'saas' });
        track(p.id);
        await harness.assertConsistency?.product?.(p);
        let result: ProviderProduct | null = null;
        await expect(
          (async () => {
            result = await provider.products.activate({ id: p.id });
          })(),
        ).resolves.not.toThrow();
        if (result !== null) {
          const r = result as ProviderProduct;
          expectIsProduct(r);
          await harness.assertConsistency?.product?.(r);
          expect(r.id).toBe(p.id);
          expect(r.active).toBe(true);
        }
      });

      // ---- validation: input shape ----
      it.each([
        ['null', null],
        ['undefined', undefined],
        ['string', 'prod_x'],
        ['number', 42],
      ])('rejects non-object input (%s)', async (_label, value) => {
        await expect(provider.products.activate(value as any)).rejects.toBeInstanceOf(
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
        await expect(provider.products.activate(input as any)).rejects.toBeInstanceOf(
          ProviderValidationError,
        );
      });
    });

    // -------------------------------------------------------------------------
    // Best-effort cleanup: deactivate every product we created and run the
    // harness teardown. Failures are swallowed so a flaky cleanup never masks
    // a real test failure.
    // -------------------------------------------------------------------------
    afterAll(async () => {
      for (const id of createdIds) {
        // Try the harness's hard-delete hook first (if any). Adapters whose
        // provider supports product deletion (e.g. Stripe via `products.del`
        // when no prices are attached) drop the resource here so test
        // residue doesn't accumulate. Fall through to the contract's
        // soft-delete either way — if hard-delete succeeded the soft call
        // 404s harmlessly; if it failed (or no hook) we at least archive.
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
