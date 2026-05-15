import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  MetadataCollisionError,
  ProviderNotFoundError,
  ProviderValidationError,
} from '../../../errors/index.js';
import type { BillingProvider, ProviderCustomer } from '../../../index.js';
import { withoutRaw } from '../../equality.js';
import type { ProviderTestHarness } from '../../harness.js';
import { nonNull } from '../../skip-if.js';

/**
 * Registers the customers automated conformance suite. All scenarios in the
 * customers brief are encoded here; this file is the spec, the brief is the
 * source of truth.
 */
export function registerCustomersAutomatedSuite(
  label: string,
  factory: () => ProviderTestHarness | Promise<ProviderTestHarness>,
): void {
  // ---------------------------------------------------------------------------
  // Helpers (intentionally inlined per the task instructions — no shared util
  // library yet).
  // ---------------------------------------------------------------------------

  function uniqueEmail(): string {
    return `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;
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

  function expectIsCustomer(c: unknown): asserts c is ProviderCustomer {
    expect(isPlainObject(c)).toBe(true);
    const rec = c as Record<string, unknown>;

    expect(typeof rec.id).toBe('string');
    expect((rec.id as string).length).toBeGreaterThan(0);

    expect(rec.email === null || typeof rec.email === 'string').toBe(true);
    expect(rec.name === null || typeof rec.name === 'string').toBe(true);

    expect(isPlainObject(rec.metadata)).toBe(true);
    for (const [k, v] of Object.entries(rec.metadata as Record<string, unknown>)) {
      expect(typeof v).toBe('string');
      // Reserved keys must never appear on returned metadata.
      expect(k.startsWith('__provider_')).toBe(false);
    }

    expect(rec.createdAt).toBeInstanceOf(Date);
    expect(Number.isFinite((rec.createdAt as Date).getTime())).toBe(true);
  }

  function expectCreatedAtRecent(c: ProviderCustomer): void {
    const now = Date.now();
    const fiveMinutes = 5 * 60 * 1000;
    const ts = c.createdAt.getTime();
    expect(ts).toBeGreaterThanOrEqual(now - fiveMinutes);
    expect(ts).toBeLessThanOrEqual(now + fiveMinutes);
  }

  // ---------------------------------------------------------------------------
  // Outer describe — acquires harness once, registers per-method describes.
  // ---------------------------------------------------------------------------

  describe(`customers [${label}]`, () => {
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
    // customers.create
    // -------------------------------------------------------------------------
    describe('customers.create', () => {
      it('returns a ProviderCustomer with sensible defaults for create({})', async () => {
        const c = await provider.customers.create({});
        track(c.id);
        expectIsCustomer(c);
        await harness.assertConsistency?.customer?.(c);
        expect(c.email).toBeNull();
        expect(c.name).toBeNull();
        expect(c.metadata).toEqual({});
        expectCreatedAtRecent(c);
      });

      it('round-trips email/name/metadata on create', async () => {
        const email = uniqueEmail();
        const name = 'Ada Lovelace';
        const metadata = { plan: 'pro', source: 'signup' };
        const c = await provider.customers.create({ email, name, metadata });
        track(c.id);
        expectIsCustomer(c);
        await harness.assertConsistency?.customer?.(c);
        expect(c.email).toBe(email);
        expect(c.name).toBe(name);
        expect(c.metadata).toEqual(metadata);
        expectCreatedAtRecent(c);
      });

      it('distinct create calls produce distinct ids', async () => {
        const a = await provider.customers.create({});
        const b = await provider.customers.create({});
        track(a.id);
        track(b.id);
        await harness.assertConsistency?.customer?.(a);
        await harness.assertConsistency?.customer?.(b);
        expect(a.id).not.toBe(b.id);
      });

      it('get returns a deep-equal record after create', async () => {
        const email = uniqueEmail();
        const c = await provider.customers.create({ email, name: 'Lookup' });
        track(c.id);
        await harness.assertConsistency?.customer?.(c);
        const got = await provider.customers.get({ id: c.id });
        expect(withoutRaw(nonNull(got, 'got'))).toEqual(withoutRaw(c));
      });

      // ---- validation: input shape ----
      it.each([
        ['undefined input', undefined],
        ['null input', null],
        ['string input', 'foo'],
        ['number input', 42],
        ['boolean input', true],
      ])('rejects non-object input (%s)', async (_label, value) => {
        await expect(provider.customers.create(value as any)).rejects.toBeInstanceOf(
          ProviderValidationError,
        );
      });

      // ---- validation: email ----
      it.each([
        ['empty string', ''],
        ['not-an-email', 'not-email'],
        ['missing tld', 'a@'],
        ['contains space', 'a b@c.d'],
        ['number', 42],
        ['boolean', true],
        ['array', ['a@b.c']],
        ['object', { x: 1 }],
      ])('rejects invalid email (%s)', async (_label, value) => {
        await expect(provider.customers.create({ email: value as any })).rejects.toBeInstanceOf(
          ProviderValidationError,
        );
      });

      // ---- validation: name ----
      it.each([
        ['empty string', ''],
        ['number', 42],
        ['boolean', true],
        ['array', ['x']],
        ['object', { x: 1 }],
      ])('rejects invalid name (%s)', async (_label, value) => {
        await expect(provider.customers.create({ name: value as any })).rejects.toBeInstanceOf(
          ProviderValidationError,
        );
      });

      // ---- validation: metadata shape & values ----
      it.each([
        ['number', 42],
        ['boolean', true],
        ['array', [['k', 'v']]],
        ['string', 'foo'],
      ])('rejects non-object metadata (%s)', async (_label, value) => {
        await expect(provider.customers.create({ metadata: value as any })).rejects.toBeInstanceOf(
          ProviderValidationError,
        );
      });

      it.each([
        ['number value', { plan: 1 as any }],
        ['boolean value', { plan: true as any }],
        ['null value', { plan: null as any }],
        ['nested object value', { plan: { tier: 'pro' } as any }],
      ])('rejects metadata with non-string values (%s)', async (_label, metadata) => {
        await expect(
          provider.customers.create({ metadata: metadata as any }),
        ).rejects.toBeInstanceOf(ProviderValidationError);
      });

      it('throws MetadataCollisionError (422) for reserved __provider_ keys', async () => {
        const err = await provider.customers
          .create({ metadata: { __provider_secret: 'x' } as any })
          .then(
            () => null,
            (e: unknown) => e,
          );
        expect(err).toBeInstanceOf(MetadataCollisionError);
        expect((err as MetadataCollisionError).status).toBe(422);
      });
    });

    // -------------------------------------------------------------------------
    // customers.get
    // -------------------------------------------------------------------------
    describe('customers.get', () => {
      let seed: ProviderCustomer;

      beforeEach(async () => {
        seed = await provider.customers.create({ email: uniqueEmail(), name: 'Seed' });
        track(seed.id);
        await harness.assertConsistency?.customer?.(seed);
      });

      it('returns a deep-equal record for an existing id', async () => {
        const got = await provider.customers.get({ id: seed.id });
        expect(withoutRaw(nonNull(got, 'got'))).toEqual(withoutRaw(seed));
      });

      it('returns null (does not throw) for a missing id', async () => {
        const got = await provider.customers.get({ id: 'cus_definitely_does_not_exist_xyz_123' });
        expect(got).toBeNull();
      });

      // ---- validation: input shape ----
      it.each([
        ['undefined', undefined],
        ['null', null],
        ['string', 'cus_123'],
        ['number', 42],
      ])('rejects non-object input (%s)', async (_label, value) => {
        await expect(provider.customers.get(value as any)).rejects.toBeInstanceOf(
          ProviderValidationError,
        );
      });

      // ---- validation: id field ----
      it.each([
        ['missing', {}],
        ['empty string', { id: '' }],
        ['null', { id: null as any }],
        ['number', { id: 42 as any }],
        ['boolean', { id: true as any }],
        ['object', { id: { x: 1 } as any }],
      ])('rejects invalid id (%s)', async (_label, input) => {
        await expect(provider.customers.get(input as any)).rejects.toBeInstanceOf(
          ProviderValidationError,
        );
      });
    });

    // -------------------------------------------------------------------------
    // customers.list
    // -------------------------------------------------------------------------
    describe('customers.list', () => {
      it('returns an array (never null/undefined) with no input', async () => {
        const out = await provider.customers.list();
        expectIsPage<ProviderCustomer>(out);
        for (const c of out.data) expectIsCustomer(c);
      });

      it('returns an array (never null/undefined) with empty input', async () => {
        const out = await provider.customers.list({});
        expectIsPage<ProviderCustomer>(out);
      });

      it('includes both records after creating A and B', async () => {
        const a = await provider.customers.create({ email: uniqueEmail(), name: 'A' });
        const b = await provider.customers.create({ email: uniqueEmail(), name: 'B' });
        track(a.id);
        track(b.id);
        await harness.assertConsistency?.customer?.(a);
        await harness.assertConsistency?.customer?.(b);
        // Page through until we find both, in case the provider paginates.
        const seen = new Set<string>();
        let cursor: string | undefined;
        for (let i = 0; i < 50; i++) {
          const page = await provider.customers.list(
            cursor ? { cursor, limit: 100 } : { limit: 100 },
          );
          expectIsPage<ProviderCustomer>(page);
          for (const c of page.data) seen.add(c.id);
          if (seen.has(a.id) && seen.has(b.id)) break;
          if (page.data.length === 0) break;
          // No cursor protocol is contractually guaranteed at the response level
          // in the brief; if a provider can't provide one we just rely on a big
          // first page. Break out to avoid an infinite loop.
          break;
        }
        expect(seen.has(a.id)).toBe(true);
        expect(seen.has(b.id)).toBe(true);
      });

      it('filters by email and returns only matching records', async () => {
        const email = uniqueEmail();
        const c = await provider.customers.create({ email, name: 'Filter' });
        track(c.id);
        await harness.assertConsistency?.customer?.(c);
        const out = await provider.customers.list({ email });
        expectIsPage<ProviderCustomer>(out);
        expect(out.data.length).toBeGreaterThan(0);
        for (const r of out.data) {
          expectIsCustomer(r);
          expect(r.email).toBe(email);
        }
      });

      it('caps result length when limit is supplied', async () => {
        // Ensure at least 3 customers exist so the cap is meaningful.
        for (let i = 0; i < 3; i++) {
          const c = await provider.customers.create({ email: uniqueEmail() });
          track(c.id);
          await harness.assertConsistency?.customer?.(c);
        }
        const out = await provider.customers.list({ limit: 2 });
        expectIsPage<ProviderCustomer>(out);
        expect(out.data.length).toBeLessThanOrEqual(2);
      });

      // ---- validation: input shape ----
      it.each([
        ['null', null],
        ['string', 'foo'],
        ['number', 42],
        ['boolean', true],
      ])('rejects non-object input (%s)', async (_label, value) => {
        await expect(provider.customers.list(value as any)).rejects.toBeInstanceOf(
          ProviderValidationError,
        );
      });

      // ---- validation: email ----
      it.each([
        ['empty', ''],
        ['not-an-email', 'not-an-email'],
        ['number', 42],
        ['boolean', true],
        ['object', { x: 1 }],
        ['null', null],
      ])('rejects invalid email filter (%s)', async (_label, value) => {
        await expect(provider.customers.list({ email: value as any })).rejects.toBeInstanceOf(
          ProviderValidationError,
        );
      });

      // ---- validation: cursor ----
      it('rejects empty cursor', async () => {
        await expect(provider.customers.list({ cursor: '' })).rejects.toBeInstanceOf(
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
        await expect(provider.customers.list({ limit: value as any })).rejects.toBeInstanceOf(
          ProviderValidationError,
        );
      });
    });

    // -------------------------------------------------------------------------
    // customers.update
    // -------------------------------------------------------------------------
    describe('customers.update', () => {
      it('partial update preserves untouched fields (name change keeps email)', async () => {
        const email = uniqueEmail();
        const c = await provider.customers.create({ email, name: 'Original' });
        track(c.id);
        await harness.assertConsistency?.customer?.(c);
        const u = await provider.customers.update({ id: c.id, name: 'Renamed' });
        expectIsCustomer(u);
        await harness.assertConsistency?.customer?.(u);
        expect(u.id).toBe(c.id);
        expect(u.name).toBe('Renamed');
        expect(u.email).toBe(email);
        // createdAt preserved
        expect(u.createdAt.getTime()).toBe(c.createdAt.getTime());
      });

      it('update({id, email: null}) clears the email', async () => {
        const c = await provider.customers.create({ email: uniqueEmail(), name: 'Clear' });
        track(c.id);
        await harness.assertConsistency?.customer?.(c);
        const u = await provider.customers.update({ id: c.id, email: null });
        expectIsCustomer(u);
        await harness.assertConsistency?.customer?.(u);
        expect(u.email).toBeNull();
        expect(u.name).toBe('Clear');
      });

      it('update({id, metadata}) REPLACES metadata (does not merge)', async () => {
        const c = await provider.customers.create({
          email: uniqueEmail(),
          metadata: { keep: 'no', also: 'no' },
        });
        track(c.id);
        await harness.assertConsistency?.customer?.(c);
        const u = await provider.customers.update({
          id: c.id,
          metadata: { fresh: 'yes' },
        });
        expectIsCustomer(u);
        await harness.assertConsistency?.customer?.(u);
        expect(u.metadata).toEqual({ fresh: 'yes' });
      });

      it('update({id}) is a no-op and returns equivalent record', async () => {
        const c = await provider.customers.create({
          email: uniqueEmail(),
          name: 'Noop',
          metadata: { a: '1' },
        });
        track(c.id);
        await harness.assertConsistency?.customer?.(c);
        const u = await provider.customers.update({ id: c.id });
        expectIsCustomer(u);
        await harness.assertConsistency?.customer?.(u);
        expect(u.id).toBe(c.id);
        expect(u.email).toBe(c.email);
        expect(u.name).toBe(c.name);
        expect(u.metadata).toEqual(c.metadata);
        expect(u.createdAt.getTime()).toBe(c.createdAt.getTime());
      });

      it('after update, get returns the deep-equal updated record', async () => {
        const c = await provider.customers.create({ email: uniqueEmail(), name: 'PreGet' });
        track(c.id);
        await harness.assertConsistency?.customer?.(c);
        const u = await provider.customers.update({ id: c.id, name: 'PostGet' });
        await harness.assertConsistency?.customer?.(u);
        const got = await provider.customers.get({ id: c.id });
        expect(withoutRaw(nonNull(got, 'got'))).toEqual(withoutRaw(u));
      });

      it('throws ProviderNotFoundError (404) for a missing id', async () => {
        const err = await provider.customers
          .update({ id: 'cus_definitely_does_not_exist_xyz_999', name: 'Ghost' })
          .then(
            () => null,
            (e: unknown) => e,
          );
        expect(err).toBeInstanceOf(ProviderNotFoundError);
        expect((err as ProviderNotFoundError).status).toBe(404);
      });

      it('throws MetadataCollisionError (422) for reserved __provider_ keys', async () => {
        const c = await provider.customers.create({ email: uniqueEmail() });
        track(c.id);
        await harness.assertConsistency?.customer?.(c);
        const err = await provider.customers
          .update({ id: c.id, metadata: { __provider_x: 'y' } as any })
          .then(
            () => null,
            (e: unknown) => e,
          );
        expect(err).toBeInstanceOf(MetadataCollisionError);
        expect((err as MetadataCollisionError).status).toBe(422);
      });

      // ---- validation: id ----
      it.each([
        ['missing', {}],
        ['empty', { id: '' }],
        ['null', { id: null as any }],
        ['number', { id: 42 as any }],
        ['boolean', { id: true as any }],
      ])('rejects invalid id (%s)', async (_label, input) => {
        await expect(provider.customers.update(input as any)).rejects.toBeInstanceOf(
          ProviderValidationError,
        );
      });

      // ---- validation: input shape ----
      it.each([
        ['undefined', undefined],
        ['null', null],
        ['string', 'cus_x'],
        ['number', 42],
      ])('rejects non-object input (%s)', async (_label, value) => {
        await expect(provider.customers.update(value as any)).rejects.toBeInstanceOf(
          ProviderValidationError,
        );
      });

      // ---- validation: email (applied to update) ----
      it.each([
        ['empty', ''],
        ['not-email', 'not-email'],
        ['malformed', 'a@'],
        ['space', 'a b@c.d'],
        ['number', 42],
        ['boolean', true],
        ['array', ['a@b.c']],
        ['object', { x: 1 }],
      ])('rejects invalid email on update (%s)', async (_label, value) => {
        // Use a placeholder id; validation must trip before the provider lookup.
        await expect(
          provider.customers.update({ id: 'cus_x', email: value as any }),
        ).rejects.toBeInstanceOf(ProviderValidationError);
      });

      // ---- validation: name (applied to update) ----
      it.each([
        ['empty', ''],
        ['number', 42],
        ['boolean', true],
        ['object', { x: 1 }],
      ])('rejects invalid name on update (%s)', async (_label, value) => {
        await expect(
          provider.customers.update({ id: 'cus_x', name: value as any }),
        ).rejects.toBeInstanceOf(ProviderValidationError);
      });

      // ---- validation: metadata (applied to update) ----
      it.each([
        ['number', 42],
        ['boolean', true],
        ['array', [['k', 'v']]],
        ['string', 'foo'],
      ])('rejects non-object metadata on update (%s)', async (_label, value) => {
        await expect(
          provider.customers.update({ id: 'cus_x', metadata: value as any }),
        ).rejects.toBeInstanceOf(ProviderValidationError);
      });

      it.each([
        ['number value', { plan: 1 as any }],
        ['boolean value', { plan: true as any }],
        ['null value', { plan: null as any }],
        ['nested object', { plan: { tier: 'pro' } as any }],
      ])('rejects metadata with non-string values on update (%s)', async (_label, metadata) => {
        await expect(
          provider.customers.update({ id: 'cus_x', metadata: metadata as any }),
        ).rejects.toBeInstanceOf(ProviderValidationError);
      });
    });

    // -------------------------------------------------------------------------
    // customers.archive
    // -------------------------------------------------------------------------
    describe('customers.archive', () => {
      it('archives an existing customer and returns a record with the same id', async () => {
        const c = await provider.customers.create({ email: uniqueEmail(), name: 'Archive' });
        track(c.id);
        await harness.assertConsistency?.customer?.(c);
        const archived = await provider.customers.archive({ id: c.id });
        expect(archived).not.toBeNull();
        expectIsCustomer(archived as ProviderCustomer);
        await harness.assertConsistency?.customer?.(archived as ProviderCustomer);
        expect((archived as ProviderCustomer).id).toBe(c.id);
      });

      it('returns null (does not throw) for a missing id', async () => {
        const out = await provider.customers.archive({
          id: 'cus_definitely_does_not_exist_xyz_777',
        });
        expect(out).toBeNull();
      });

      it('is idempotent — a second archive on the same id does not throw', async () => {
        const c = await provider.customers.create({ email: uniqueEmail() });
        track(c.id);
        await harness.assertConsistency?.customer?.(c);
        const first = await provider.customers.archive({ id: c.id });
        if (first !== null) {
          await harness.assertConsistency?.customer?.(first);
        }
        let second: ProviderCustomer | null = null;
        await expect(
          (async () => {
            second = await provider.customers.archive({ id: c.id });
          })(),
        ).resolves.not.toThrow();
        // Allow either null or a record with the same id on the second call.
        if (second !== null) {
          expect((second as ProviderCustomer).id).toBe(c.id);
          await harness.assertConsistency?.customer?.(second);
        }
      });

      // ---- validation: input shape ----
      it.each([
        ['undefined', undefined],
        ['null', null],
        ['string', 'cus_x'],
        ['number', 42],
        ['boolean', true],
      ])('rejects non-object input (%s)', async (_label, value) => {
        await expect(provider.customers.archive(value as any)).rejects.toBeInstanceOf(
          ProviderValidationError,
        );
      });

      // ---- validation: id ----
      it.each([
        ['missing', {}],
        ['empty', { id: '' }],
        ['null', { id: null as any }],
        ['number', { id: 42 as any }],
        ['boolean', { id: true as any }],
      ])('rejects invalid id (%s)', async (_label, input) => {
        await expect(provider.customers.archive(input as any)).rejects.toBeInstanceOf(
          ProviderValidationError,
        );
      });
    });

    // -------------------------------------------------------------------------
    // Best-effort cleanup: archive every customer we created and run the
    // harness teardown. Failures are swallowed so a flaky cleanup never masks
    // a real test failure.
    // -------------------------------------------------------------------------
    afterAll(async () => {
      for (const id of createdIds) {
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
