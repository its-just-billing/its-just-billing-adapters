import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type {
  BillingProvider,
  ProviderEventType,
  ProviderWebhookEndpoint,
} from '../../../index.js';

type WebhooksCreateEndpointOutput = ProviderWebhookEndpoint & { secret: string | null };
import {
  ProviderNotFoundError,
  ProviderValidationError,
  WebhookSignatureError,
} from '../../../errors/index.js';
import type { ProviderTestHarness } from '../../harness.js';

/**
 * Registers the webhooks automated conformance suite. All scenarios in the
 * webhooks brief are encoded here; this file is the spec, the brief is the
 * source of truth.
 */
export function registerWebhooksAutomatedSuite(
  label: string,
  factory: () => ProviderTestHarness | Promise<ProviderTestHarness>,
): void {
  // ---------------------------------------------------------------------------
  // Helpers (intentionally inlined per the task instructions — no shared util
  // library yet).
  // ---------------------------------------------------------------------------

  function unique(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function uniqueUrl(): string {
    return `https://example.com/hook-${unique()}`;
  }

  function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  // Closed enum mirrored from ProviderEventTypeSchema. Used by the type guard
  // to assert returned eventTypes are in the contract enum.
  const KNOWN_EVENT_TYPES: ReadonlySet<string> = new Set<ProviderEventType>([
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

  function expectIsEndpoint(e: unknown): asserts e is ProviderWebhookEndpoint {
    expect(isPlainObject(e)).toBe(true);
    const rec = e as Record<string, unknown>;

    expect(typeof rec.id).toBe('string');
    expect((rec.id as string).length).toBeGreaterThan(0);

    expect(typeof rec.url).toBe('string');
    // valid URL — constructor throws on invalid input.
    expect(() => new URL(rec.url as string)).not.toThrow();

    expect(Array.isArray(rec.eventTypes)).toBe(true);
    for (const t of rec.eventTypes as unknown[]) {
      expect(typeof t).toBe('string');
      expect(KNOWN_EVENT_TYPES.has(t as string)).toBe(true);
    }

    expect(typeof rec.active).toBe('boolean');

    expect(rec.createdAt).toBeInstanceOf(Date);
    expect(Number.isFinite((rec.createdAt as Date).getTime())).toBe(true);
  }

  function expectIsCreateOutput(e: unknown): asserts e is WebhooksCreateEndpointOutput {
    expectIsEndpoint(e);
    const rec = e as Record<string, unknown>;
    // secret may be null OR a non-empty string. Both are valid.
    if (rec.secret === null) {
      expect(rec.secret).toBeNull();
    } else {
      expect(typeof rec.secret).toBe('string');
      expect((rec.secret as string).length).toBeGreaterThan(0);
    }
  }

  // ---------------------------------------------------------------------------
  // Outer describe — acquires harness once, registers per-method describes.
  // ---------------------------------------------------------------------------

  describe(`webhooks [${label}]`, () => {
    let harness: ProviderTestHarness;
    let provider: BillingProvider;
    const createdIds = new Set<string>();

    beforeAll(async () => {
      harness = await factory();
      provider = harness.provider;
    });

    /**
     * Track an id for best-effort deletion at the end of the outer describe.
     */
    function track(id: string): void {
      createdIds.add(id);
    }

    // -------------------------------------------------------------------------
    // webhooks.listEndpoints
    // -------------------------------------------------------------------------
    describe('webhooks.listEndpoints', () => {
      it('returns an array (never null/undefined) with no input', async () => {
        const out = await provider.webhooks.listEndpoints();
        expectIsPage<ProviderWebhookEndpoint>(out);
        for (const e of out.data) expectIsEndpoint(e);
      });

      it('returns an array (never null/undefined) with empty input', async () => {
        const out = await provider.webhooks.listEndpoints({});
        expectIsPage<ProviderWebhookEndpoint>(out);
        for (const e of out.data) expectIsEndpoint(e);
      });
    });

    // -------------------------------------------------------------------------
    // webhooks.createEndpoint
    // -------------------------------------------------------------------------
    describe('webhooks.createEndpoint', () => {
      it('creates an endpoint and round-trips url/eventTypes', async () => {
        const url = uniqueUrl();
        const eventTypes: ProviderEventType[] = ['customer.created', 'subscription.updated'];
        const created = await provider.webhooks.createEndpoint({ url, eventTypes });
        track(created.id);
        expectIsCreateOutput(created);
        await harness.assertConsistency?.webhookEndpoint?.(created);
        expect(created.url).toBe(url);
        for (const t of eventTypes) {
          expect(created.eventTypes).toContain(t);
        }
      });

      it('listEndpoints includes the new endpoint by id, then delete it', async () => {
        const url = uniqueUrl();
        const created = await provider.webhooks.createEndpoint({
          url,
          eventTypes: ['customer.created', 'subscription.updated'],
        });
        track(created.id);
        await harness.assertConsistency?.webhookEndpoint?.(created);
        const list = await provider.webhooks.listEndpoints();
        expectIsPage<ProviderWebhookEndpoint>(list);
        expect(list.data.some((e) => e.id === created.id)).toBe(true);
        const del = await provider.webhooks.deleteEndpoint({ id: created.id });
        expect(del).toEqual({ deleted: true });
      });

      // ---- validation: input shape ----
      it.each([
        ['null', null],
        ['undefined', undefined],
        ['string', 'foo'],
        ['number', 42],
        ['boolean', true],
      ])('rejects non-object input (%s)', async (_label, value) => {
        await expect(provider.webhooks.createEndpoint(value as any)).rejects.toBeInstanceOf(
          ProviderValidationError,
        );
      });

      // ---- validation: url ----
      it.each([
        ['missing', { eventTypes: ['customer.created'] }],
        ['empty', { url: '', eventTypes: ['customer.created'] }],
        ['number', { url: 123 as any, eventTypes: ['customer.created'] }],
        ['null', { url: null as any, eventTypes: ['customer.created'] }],
        ['object', { url: {} as any, eventTypes: ['customer.created'] }],
        ['not a url', { url: 'not a url', eventTypes: ['customer.created'] }],
      ])('rejects invalid url (%s)', async (_label, input) => {
        await expect(provider.webhooks.createEndpoint(input as any)).rejects.toBeInstanceOf(
          ProviderValidationError,
        );
      });

      // ---- validation: eventTypes ----
      it.each([
        ['missing', { url: 'https://example.com/hook' }],
        ['empty array', { url: 'https://example.com/hook', eventTypes: [] }],
        [
          'string instead of array',
          { url: 'https://example.com/hook', eventTypes: 'customer.created' as any },
        ],
        [
          'unknown enum value',
          { url: 'https://example.com/hook', eventTypes: ['customer.invented'] as any },
        ],
        ['number element', { url: 'https://example.com/hook', eventTypes: [42] as any }],
        ['null', { url: 'https://example.com/hook', eventTypes: null as any }],
      ])('rejects invalid eventTypes (%s)', async (_label, input) => {
        await expect(provider.webhooks.createEndpoint(input as any)).rejects.toBeInstanceOf(
          ProviderValidationError,
        );
      });
    });

    // -------------------------------------------------------------------------
    // webhooks.updateEndpoint
    // -------------------------------------------------------------------------
    describe('webhooks.updateEndpoint', () => {
      it('updates the url; same id; other fields preserved', async () => {
        const created = await provider.webhooks.createEndpoint({
          url: uniqueUrl(),
          eventTypes: ['customer.created', 'subscription.updated'],
        });
        track(created.id);
        await harness.assertConsistency?.webhookEndpoint?.(created);
        const newUrl = uniqueUrl();
        const updated = await provider.webhooks.updateEndpoint({
          id: created.id,
          url: newUrl,
        });
        expectIsEndpoint(updated);
        await harness.assertConsistency?.webhookEndpoint?.(updated);
        expect(updated.id).toBe(created.id);
        expect(updated.url).toBe(newUrl);
        // eventTypes preserved.
        for (const t of created.eventTypes) {
          expect(updated.eventTypes).toContain(t);
        }
      });

      it('updates eventTypes; same id; url preserved', async () => {
        const created = await provider.webhooks.createEndpoint({
          url: uniqueUrl(),
          eventTypes: ['customer.created'],
        });
        track(created.id);
        await harness.assertConsistency?.webhookEndpoint?.(created);
        const newEventTypes: ProviderEventType[] = [
          'subscription.created',
          'subscription.canceled',
        ];
        const updated = await provider.webhooks.updateEndpoint({
          id: created.id,
          eventTypes: newEventTypes,
        });
        expectIsEndpoint(updated);
        await harness.assertConsistency?.webhookEndpoint?.(updated);
        expect(updated.id).toBe(created.id);
        expect(updated.url).toBe(created.url);
        // The returned eventTypes reflect the new list. Order is not guaranteed.
        const set = new Set(updated.eventTypes);
        for (const t of newEventTypes) {
          expect(set.has(t)).toBe(true);
        }
        expect(set.size).toBe(newEventTypes.length);
      });

      it('toggles active=false then back to active=true', async () => {
        const created = await provider.webhooks.createEndpoint({
          url: uniqueUrl(),
          eventTypes: ['customer.created'],
        });
        track(created.id);
        await harness.assertConsistency?.webhookEndpoint?.(created);

        const off = await provider.webhooks.updateEndpoint({
          id: created.id,
          active: false,
        });
        expectIsEndpoint(off);
        await harness.assertConsistency?.webhookEndpoint?.(off);
        expect(off.id).toBe(created.id);
        expect(off.active).toBe(false);

        const on = await provider.webhooks.updateEndpoint({
          id: created.id,
          active: true,
        });
        expectIsEndpoint(on);
        await harness.assertConsistency?.webhookEndpoint?.(on);
        expect(on.id).toBe(created.id);
        expect(on.active).toBe(true);
      });

      it('update({id}) with no field changes is valid; resolves to current endpoint', async () => {
        const created = await provider.webhooks.createEndpoint({
          url: uniqueUrl(),
          eventTypes: ['customer.created'],
        });
        track(created.id);
        await harness.assertConsistency?.webhookEndpoint?.(created);
        const updated = await provider.webhooks.updateEndpoint({ id: created.id });
        expectIsEndpoint(updated);
        await harness.assertConsistency?.webhookEndpoint?.(updated);
        expect(updated.id).toBe(created.id);
        expect(updated.url).toBe(created.url);
        for (const t of created.eventTypes) {
          expect(updated.eventTypes).toContain(t);
        }
      });

      // ---- validation: input shape ----
      it.each([
        ['null', null],
        ['undefined', undefined],
        ['string', 'wh_x'],
        ['number', 42],
        ['boolean', true],
      ])('rejects non-object input (%s)', async (_label, value) => {
        await expect(provider.webhooks.updateEndpoint(value as any)).rejects.toBeInstanceOf(
          ProviderValidationError,
        );
      });

      // ---- validation: id ----
      it.each([
        ['missing', {}],
        ['empty', { id: '' }],
        ['number', { id: 42 as any }],
        ['null', { id: null as any }],
      ])('rejects invalid id (%s)', async (_label, input) => {
        await expect(provider.webhooks.updateEndpoint(input as any)).rejects.toBeInstanceOf(
          ProviderValidationError,
        );
      });

      // ---- validation: url ----
      it.each([
        ['empty', ''],
        ['not a url', 'not a url'],
        ['number', 123 as any],
      ])('rejects invalid url (%s)', async (_label, value) => {
        await expect(
          provider.webhooks.updateEndpoint({ id: 'wh_x', url: value as any }),
        ).rejects.toBeInstanceOf(ProviderValidationError);
      });

      // ---- validation: eventTypes ----
      it.each([
        ['empty array', [] as any],
        ['unknown enum value', ['customer.invented'] as any],
        ['number element', [42] as any],
      ])('rejects invalid eventTypes (%s)', async (_label, value) => {
        await expect(
          provider.webhooks.updateEndpoint({ id: 'wh_x', eventTypes: value as any }),
        ).rejects.toBeInstanceOf(ProviderValidationError);
      });

      // ---- validation: active ----
      it.each([
        ['string', 'true' as any],
        ['number', 1 as any],
        ['null', null as any],
      ])('rejects non-boolean active (%s)', async (_label, value) => {
        await expect(
          provider.webhooks.updateEndpoint({ id: 'wh_x', active: value as any }),
        ).rejects.toBeInstanceOf(ProviderValidationError);
      });

      // ---- not found ----
      it('throws ProviderNotFoundError (404) when id does not exist', async () => {
        const err = await provider.webhooks
          .updateEndpoint({
            id: `wh_does_not_exist_${unique()}`,
            url: uniqueUrl(),
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
    // webhooks.activateEndpoint
    // -------------------------------------------------------------------------
    describe('webhooks.activateEndpoint', () => {
      it('happy path: deactivate then activate yields active=true', async () => {
        const created = await provider.webhooks.createEndpoint({
          url: uniqueUrl(),
          eventTypes: ['customer.created'],
        });
        track(created.id);
        await harness.assertConsistency?.webhookEndpoint?.(created);
        expect(created.active).toBe(true);

        const deactivated = await provider.webhooks.deactivateEndpoint({
          id: created.id,
        });
        expect(deactivated).not.toBeNull();
        expect((deactivated as ProviderWebhookEndpoint).active).toBe(false);
        await harness.assertConsistency?.webhookEndpoint?.(deactivated as ProviderWebhookEndpoint);

        const activated = await provider.webhooks.activateEndpoint({ id: created.id });
        expect(activated).not.toBeNull();
        const a = activated as ProviderWebhookEndpoint;
        expectIsEndpoint(a);
        await harness.assertConsistency?.webhookEndpoint?.(a);
        expect(a.id).toBe(created.id);
        expect(a.active).toBe(true);
      });

      it('returns null for a missing id', async () => {
        const out = await provider.webhooks.activateEndpoint({
          id: `wh_does_not_exist_${unique()}`,
        });
        expect(out).toBeNull();
      });

      // ---- validation: input shape ----
      it.each([
        ['null', null],
        ['undefined', undefined],
        ['string', 'wh_x'],
        ['number', 42],
      ])('rejects non-object input (%s)', async (_label, value) => {
        await expect(provider.webhooks.activateEndpoint(value as any)).rejects.toBeInstanceOf(
          ProviderValidationError,
        );
      });

      // ---- validation: id ----
      it.each([
        ['missing', {}],
        ['empty', { id: '' }],
        ['number', { id: 42 as any }],
        ['null', { id: null as any }],
      ])('rejects invalid id (%s)', async (_label, input) => {
        await expect(provider.webhooks.activateEndpoint(input as any)).rejects.toBeInstanceOf(
          ProviderValidationError,
        );
      });
    });

    // -------------------------------------------------------------------------
    // webhooks.deactivateEndpoint
    // -------------------------------------------------------------------------
    describe('webhooks.deactivateEndpoint', () => {
      it('happy path: deactivate flips active=false; endpoint still present in listEndpoints', async () => {
        const created = await provider.webhooks.createEndpoint({
          url: uniqueUrl(),
          eventTypes: ['customer.created'],
        });
        track(created.id);
        await harness.assertConsistency?.webhookEndpoint?.(created);

        const deactivated = await provider.webhooks.deactivateEndpoint({
          id: created.id,
        });
        expect(deactivated).not.toBeNull();
        const d = deactivated as ProviderWebhookEndpoint;
        expectIsEndpoint(d);
        await harness.assertConsistency?.webhookEndpoint?.(d);
        expect(d.id).toBe(created.id);
        expect(d.active).toBe(false);

        const list = await provider.webhooks.listEndpoints();
        expectIsPage<ProviderWebhookEndpoint>(list);
        expect(list.data.some((e) => e.id === created.id)).toBe(true);
      });

      it('returns null for a missing id', async () => {
        const out = await provider.webhooks.deactivateEndpoint({
          id: `wh_does_not_exist_${unique()}`,
        });
        expect(out).toBeNull();
      });

      // ---- validation: input shape ----
      it.each([
        ['null', null],
        ['undefined', undefined],
        ['string', 'wh_x'],
        ['number', 42],
      ])('rejects non-object input (%s)', async (_label, value) => {
        await expect(provider.webhooks.deactivateEndpoint(value as any)).rejects.toBeInstanceOf(
          ProviderValidationError,
        );
      });

      // ---- validation: id ----
      it.each([
        ['missing', {}],
        ['empty', { id: '' }],
        ['number', { id: 42 as any }],
        ['null', { id: null as any }],
      ])('rejects invalid id (%s)', async (_label, input) => {
        await expect(provider.webhooks.deactivateEndpoint(input as any)).rejects.toBeInstanceOf(
          ProviderValidationError,
        );
      });
    });

    // -------------------------------------------------------------------------
    // webhooks.deleteEndpoint
    // -------------------------------------------------------------------------
    describe('webhooks.deleteEndpoint', () => {
      it('returns {deleted: true} after creating an endpoint', async () => {
        const created = await provider.webhooks.createEndpoint({
          url: uniqueUrl(),
          eventTypes: ['customer.created'],
        });
        track(created.id);
        await harness.assertConsistency?.webhookEndpoint?.(created);
        const out = await provider.webhooks.deleteEndpoint({ id: created.id });
        expect(out).toEqual({ deleted: true });
      });

      it('missing id: resolves to {deleted: false} OR rejects with ProviderNotFoundError(404)', async () => {
        const id = `wh_does_not_exist_${unique()}`;
        let resolved: { deleted: boolean } | null = null;
        let rejected: unknown = null;
        try {
          resolved = await provider.webhooks.deleteEndpoint({ id });
        } catch (e) {
          rejected = e;
        }
        // Exactly one of the two outcomes must hold.
        const isResolveOk = resolved !== null && resolved.deleted === false;
        const isRejectOk =
          rejected instanceof ProviderNotFoundError &&
          (rejected as ProviderNotFoundError).status === 404;
        expect(isResolveOk !== isRejectOk).toBe(true);
        expect(isResolveOk || isRejectOk).toBe(true);
      });

      // ---- validation: input shape ----
      it.each([
        ['null', null],
        ['undefined', undefined],
        ['string', 'wh_123'],
        ['number', 42],
        ['boolean', true],
      ])('rejects non-object input (%s)', async (_label, value) => {
        await expect(provider.webhooks.deleteEndpoint(value as any)).rejects.toBeInstanceOf(
          ProviderValidationError,
        );
      });

      // ---- validation: id ----
      it.each([
        ['missing', {}],
        ['empty', { id: '' }],
        ['number', { id: 42 as any }],
        ['null', { id: null as any }],
        ['undefined', { id: undefined as any }],
        ['object', { id: { x: 1 } as any }],
      ])('rejects invalid id (%s)', async (_label, input) => {
        await expect(provider.webhooks.deleteEndpoint(input as any)).rejects.toBeInstanceOf(
          ProviderValidationError,
        );
      });
    });

    // -------------------------------------------------------------------------
    // webhooks.verify
    // -------------------------------------------------------------------------
    describe('webhooks.verify', () => {
      const validSecret = 'whsec_test_secret_value_for_conformance';

      // ---- validation: input shape ----
      it.each([
        ['null', null],
        ['undefined', undefined],
        ['string', 'foo'],
        ['number', 42],
        ['boolean', true],
      ])('rejects non-object input (%s)', async (_label, value) => {
        await expect(provider.webhooks.verify(value as any)).rejects.toBeInstanceOf(
          ProviderValidationError,
        );
      });

      // ---- validation: payload ----
      it.each([
        ['missing', { signature: 'sig', secret: validSecret }],
        ['number', { payload: 123 as any, signature: 'sig', secret: validSecret }],
        ['null', { payload: null as any, signature: 'sig', secret: validSecret }],
        ['object', { payload: {} as any, signature: 'sig', secret: validSecret }],
        ['array', { payload: [] as any, signature: 'sig', secret: validSecret }],
      ])('rejects invalid payload (%s)', async (_label, input) => {
        await expect(provider.webhooks.verify(input as any)).rejects.toBeInstanceOf(
          ProviderValidationError,
        );
      });

      // ---- validation: signature ----
      it.each([
        ['missing', { payload: '{}', secret: validSecret }],
        ['empty', { payload: '{}', signature: '', secret: validSecret }],
        ['number zero', { payload: '{}', signature: 0 as any, secret: validSecret }],
        ['null', { payload: '{}', signature: null as any, secret: validSecret }],
        ['undefined', { payload: '{}', signature: undefined as any, secret: validSecret }],
      ])('rejects invalid signature (%s)', async (_label, input) => {
        await expect(provider.webhooks.verify(input as any)).rejects.toBeInstanceOf(
          ProviderValidationError,
        );
      });

      // ---- validation: secret ----
      it.each([
        ['missing', { payload: '{}', signature: 'sig' }],
        ['empty', { payload: '{}', signature: 'sig', secret: '' }],
        ['number zero', { payload: '{}', signature: 'sig', secret: 0 as any }],
        ['null', { payload: '{}', signature: 'sig', secret: null as any }],
        ['undefined', { payload: '{}', signature: 'sig', secret: undefined as any }],
      ])('rejects invalid secret (%s)', async (_label, input) => {
        await expect(provider.webhooks.verify(input as any)).rejects.toBeInstanceOf(
          ProviderValidationError,
        );
      });

      // ---- invalid signature behavior ----
      const stringPayload = '{"id":"evt_test","type":"customer.created"}';
      const bytePayload = new TextEncoder().encode(stringPayload);
      const invalidSignatures: ReadonlyArray<[string, string]> = [
        ['short literal', 'invalid'],
        ['hex-ish blob', 'deadbeef'.repeat(8)],
        ['stripe-like t/v1', `t=0,v1=${'0'.repeat(64)}`],
      ];

      for (const [sigLabel, sig] of invalidSignatures) {
        it(`rejects with WebhookSignatureError (string payload, ${sigLabel})`, async () => {
          const err = await provider.webhooks
            .verify({ payload: stringPayload, signature: sig, secret: validSecret })
            .then(
              () => null,
              (e: unknown) => e,
            );
          expect(err).toBeInstanceOf(WebhookSignatureError);
          expect((err as WebhookSignatureError).status).toBe(400);
          expect((err as WebhookSignatureError).code).toBe('webhook_signature');
        });

        it(`rejects with WebhookSignatureError (Uint8Array payload, ${sigLabel})`, async () => {
          const err = await provider.webhooks
            .verify({ payload: bytePayload, signature: sig, secret: validSecret })
            .then(
              () => null,
              (e: unknown) => e,
            );
          expect(err).toBeInstanceOf(WebhookSignatureError);
          expect((err as WebhookSignatureError).status).toBe(400);
          expect((err as WebhookSignatureError).code).toBe('webhook_signature');
        });
      }
    });

    // -------------------------------------------------------------------------
    // Best-effort cleanup: delete every endpoint we created and run the
    // harness teardown. Failures are swallowed so a flaky cleanup never masks
    // a real test failure.
    // -------------------------------------------------------------------------
    afterEach(async () => {
      // Opportunistically prune any endpoints already deleted by a test, so
      // afterAll doesn't double-delete and noisy logs stay quiet. We can't
      // know per-test which ids were drained, so we just leave the set; the
      // try/catch in afterAll handles already-deleted entries.
    });

    afterAll(async () => {
      for (const id of createdIds) {
        try {
          await provider.webhooks.deleteEndpoint({ id });
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
