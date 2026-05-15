import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ProviderValidationError } from '../../../errors/index.js';
import type {
  BillingProvider,
  EventResourceKind,
  ProviderEvent,
  ProviderEventType,
} from '../../../index.js';
import type { ProviderTestHarness } from '../../harness.js';

/**
 * Registers the events automated conformance suite. All scenarios in the
 * events brief are encoded here; this file is the spec, the brief is the
 * source of truth.
 *
 * Per the brief: no polling, no state-change driving, no skipIf for emission
 * timing. We validate input handling and assert envelope shape on whatever
 * list happens to return.
 */
export function registerEventsAutomatedSuite(
  label: string,
  factory: () => ProviderTestHarness | Promise<ProviderTestHarness>,
): void {
  // ---------------------------------------------------------------------------
  // Helpers (intentionally inlined per the task instructions — no shared util
  // library yet).
  // ---------------------------------------------------------------------------

  const EVENT_TYPES: readonly ProviderEventType[] = [
    'customer.created',
    'customer.updated',
    'customer.deleted',
    'product.created',
    'product.updated',
    'product.archived',
    'price.created',
    'price.updated',
    'price.archived',
    'subscription.created',
    'subscription.updated',
    'subscription.canceled',
    'purchase.created',
    'purchase.succeeded',
    'purchase.failed',
    'purchase.refunded',
    'discount.created',
    'discount.updated',
    'discount.archived',
    'checkout_session.completed',
    'checkout_session.expired',
    'billing_document.finalized',
  ];
  const EVENT_TYPE_SET = new Set<string>(EVENT_TYPES);

  const RESOURCE_KINDS: readonly EventResourceKind[] = [
    'customer',
    'product',
    'price',
    'subscription',
    'purchase',
    'discount',
    'checkout_session',
    'billing_document',
  ];
  const RESOURCE_KIND_SET = new Set<string>(RESOURCE_KINDS);

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

  function expectIsEvent(e: unknown): asserts e is ProviderEvent {
    expect(isPlainObject(e)).toBe(true);
    const rec = e as Record<string, unknown>;

    expect(typeof rec.id).toBe('string');
    expect((rec.id as string).length).toBeGreaterThan(0);

    expect(typeof rec.type).toBe('string');
    expect(EVENT_TYPE_SET.has(rec.type as string)).toBe(true);

    expect(isPlainObject(rec.resource)).toBe(true);
    const resource = rec.resource as Record<string, unknown>;
    expect(typeof resource.kind).toBe('string');
    expect(RESOURCE_KIND_SET.has(resource.kind as string)).toBe(true);
    expect(typeof resource.id).toBe('string');
    expect((resource.id as string).length).toBeGreaterThan(0);

    expect(rec.occurredAt).toBeInstanceOf(Date);
    expect(Number.isFinite((rec.occurredAt as Date).getTime())).toBe(true);
  }

  function uniqueId(prefix: string): string {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }

  // ---------------------------------------------------------------------------
  // Outer describe — acquires harness once, registers per-method describes.
  // ---------------------------------------------------------------------------

  describe(`events [${label}]`, () => {
    let harness: ProviderTestHarness;
    let provider: BillingProvider;

    beforeAll(async () => {
      harness = await factory();
      provider = harness.provider;
    });

    // -------------------------------------------------------------------------
    // events.list
    // -------------------------------------------------------------------------
    describe('events.list', () => {
      it('returns an array (never null/undefined) with no input', async () => {
        const out = await provider.events.list();
        expectIsPage<ProviderEvent>(out);
        for (const e of out.data) expectIsEvent(e);
      });

      it('returns an array with empty input', async () => {
        const out = await provider.events.list({});
        expectIsPage<ProviderEvent>(out);
        for (const e of out.data) expectIsEvent(e);
      });

      it('honors limit and caps result length', async () => {
        const out = await provider.events.list({ limit: 5 });
        expectIsPage<ProviderEvent>(out);
        expect(out.data.length).toBeLessThanOrEqual(5);
        for (const e of out.data) expectIsEvent(e);
      });

      it('filters by types — every returned event matches the requested type', async () => {
        const out = await provider.events.list({ types: ['customer.created'] });
        expectIsPage<ProviderEvent>(out);
        for (const e of out.data) {
          expectIsEvent(e);
          expect(e.type).toBe('customer.created');
        }
      });

      it('filters by since — every returned event occurredAt >= since', async () => {
        const since = new Date(Date.now() - 60_000);
        const out = await provider.events.list({ since });
        expectIsPage<ProviderEvent>(out);
        for (const e of out.data) {
          expectIsEvent(e);
          expect(e.occurredAt.getTime()).toBeGreaterThanOrEqual(since.getTime());
        }
      });

      // ---- validation: input shape ----
      it.each([
        ['string', 'oops'],
        ['number', 42],
      ])('rejects non-object truthy input (%s)', async (_label, value) => {
        await expect(provider.events.list(value as any)).rejects.toBeInstanceOf(
          ProviderValidationError,
        );
      });

      // ---- validation: types ----
      it.each([
        ['string (not array)', 'customer.created'],
        ['unknown enum member', ['customer.exploded']],
        ['non-string element', [42]],
        ['null', null],
      ])('rejects invalid types (%s)', async (_label, value) => {
        await expect(provider.events.list({ types: value as any })).rejects.toBeInstanceOf(
          ProviderValidationError,
        );
      });

      // ---- validation: since ----
      it.each([
        ['string', '2026-01-01T00:00:00.000Z'],
        ['number (epoch ms)', 1736294400000],
        ['null', null],
      ])('rejects invalid since (%s)', async (_label, value) => {
        await expect(provider.events.list({ since: value as any })).rejects.toBeInstanceOf(
          ProviderValidationError,
        );
      });

      // ---- validation: cursor ----
      it.each([
        ['empty string', ''],
        ['number', 123],
      ])('rejects invalid cursor (%s)', async (_label, value) => {
        await expect(provider.events.list({ cursor: value as any })).rejects.toBeInstanceOf(
          ProviderValidationError,
        );
      });

      // ---- validation: limit ----
      it.each([
        ['zero', 0],
        ['negative', -1],
        ['fractional', 2.5],
        ['NaN', Number.NaN],
        ['Infinity', Number.POSITIVE_INFINITY],
        ['too large', 101],
        ['string', '10'],
      ])('rejects invalid limit (%s)', async (_label, value) => {
        await expect(provider.events.list({ limit: value as any })).rejects.toBeInstanceOf(
          ProviderValidationError,
        );
      });
    });

    // -------------------------------------------------------------------------
    // events.get
    // -------------------------------------------------------------------------
    describe('events.get', () => {
      it('returns null (does not throw) for a missing id', async () => {
        const got = await provider.events.get({ id: uniqueId('evt_does_not_exist') });
        expect(got).toBeNull();
      });

      it('round-trips an existing event id from list (when any exists)', async () => {
        const listed = await provider.events.list();
        expectIsPage<ProviderEvent>(listed);
        if (listed.data.length === 0) {
          // Per the brief: skip this assertion if list returns []. No polling,
          // no state-change driving.
          return;
        }
        const e = listed.data[0]!;
        expectIsEvent(e);
        const got = await provider.events.get({ id: e.id });
        expect(got).not.toBeNull();
        const g = got as ProviderEvent;
        expectIsEvent(g);
        expect(g.id).toBe(e.id);
        expect(g.type).toBe(e.type);
        expect(g.resource.kind).toBe(e.resource.kind);
        expect(g.resource.id).toBe(e.resource.id);
        expect(g.occurredAt.getTime()).toBe(e.occurredAt.getTime());
      });

      // ---- validation: input shape ----
      it('rejects missing input arg', async () => {
        await expect((provider.events.get as any)()).rejects.toBeInstanceOf(
          ProviderValidationError,
        );
      });

      it('rejects null input', async () => {
        await expect(provider.events.get(null as any)).rejects.toBeInstanceOf(
          ProviderValidationError,
        );
      });

      // ---- validation: id field ----
      it.each([
        ['missing', {}],
        ['empty string', { id: '' }],
        ['number', { id: 123 as any }],
        ['null', { id: null as any }],
        ['undefined', { id: undefined as any }],
      ])('rejects invalid id (%s)', async (_label, input) => {
        await expect(provider.events.get(input as any)).rejects.toBeInstanceOf(
          ProviderValidationError,
        );
      });
    });

    // -------------------------------------------------------------------------
    // Teardown: harness teardown only — events suite creates no resources.
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
