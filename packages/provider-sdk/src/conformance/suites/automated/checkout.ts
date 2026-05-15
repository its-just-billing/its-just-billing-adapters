import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  MetadataCollisionError,
  ProviderConstraintError,
  ProviderNotFoundError,
  ProviderValidationError,
} from '../../../errors/index.js';
import type {
  BillingProvider,
  ProviderCheckoutSession,
  ProviderCustomer,
  ProviderPrice,
  ProviderProduct,
} from '../../../index.js';
import type { ProviderTestHarness } from '../../harness.js';

/**
 * Registers the checkout automated conformance suite. All scenarios in the
 * checkout brief are encoded here; this file is the spec, the brief is the
 * source of truth.
 */
export function registerCheckoutAutomatedSuite(
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

  function isParsableUrl(value: unknown): value is string {
    if (typeof value !== 'string') return false;
    try {
      new URL(value);
      return true;
    } catch {
      return false;
    }
  }

  function expectIsCheckoutSession(s: unknown): asserts s is ProviderCheckoutSession {
    expect(isPlainObject(s)).toBe(true);
    const rec = s as Record<string, unknown>;

    // id
    expect(typeof rec.id).toBe('string');
    expect((rec.id as string).length).toBeGreaterThan(0);

    // presentation: provider-specific payload. Conformance only verifies the
    // field is present — the concrete shape is the adapter's TPresentation.
    expect('presentation' in rec).toBe(true);

    // status
    expect(['open', 'complete', 'expired']).toContain(rec.status);

    // customerId
    expect(rec.customerId === null || typeof rec.customerId === 'string').toBe(true);

    // lineItems
    expect(Array.isArray(rec.lineItems)).toBe(true);
    const lineItems = rec.lineItems as unknown[];
    expect(lineItems.length).toBeGreaterThanOrEqual(1);
    for (const li of lineItems) {
      expect(isPlainObject(li)).toBe(true);
      const item = li as Record<string, unknown>;
      expect(typeof item.priceId).toBe('string');
      expect((item.priceId as string).length).toBeGreaterThan(0);
      expect(isPositiveInt(item.quantity)).toBe(true);
    }

    // successUrl: required valid URL
    expect(typeof rec.successUrl).toBe('string');
    expect(isParsableUrl(rec.successUrl)).toBe(true);

    // cancelUrl
    expect(rec.cancelUrl === null || typeof rec.cancelUrl === 'string').toBe(true);
    if (typeof rec.cancelUrl === 'string') {
      expect(isParsableUrl(rec.cancelUrl)).toBe(true);
    }

    // metadata
    expect(isPlainObject(rec.metadata)).toBe(true);
    for (const [k, v] of Object.entries(rec.metadata as Record<string, unknown>)) {
      expect(typeof v).toBe('string');
      expect(k.startsWith('__provider_')).toBe(false);
    }

    // expiresAt
    expect(rec.expiresAt === null || rec.expiresAt instanceof Date).toBe(true);

    // createdAt
    expect(rec.createdAt).toBeInstanceOf(Date);
    expect(Number.isFinite((rec.createdAt as Date).getTime())).toBe(true);

    // expiresAt invariant: if non-null, must be > createdAt
    if (rec.expiresAt instanceof Date) {
      expect(Number.isFinite(rec.expiresAt.getTime())).toBe(true);
      expect(rec.expiresAt.getTime()).toBeGreaterThan((rec.createdAt as Date).getTime());
    }
  }

  // ---------------------------------------------------------------------------
  // Outer describe — acquires harness once, registers per-method describes.
  // ---------------------------------------------------------------------------

  describe(`checkout [${label}]`, () => {
    let harness: ProviderTestHarness;
    let provider: BillingProvider;
    let fixtureProduct: ProviderProduct;
    let fixturePrice: ProviderPrice;
    let fixtureCustomer: ProviderCustomer;
    const createdProductIds = new Set<string>();
    const createdPriceIds = new Set<string>();
    const createdCustomerIds = new Set<string>();

    beforeAll(async () => {
      harness = await factory();
      provider = harness.provider;

      fixtureProduct = await provider.products.create({
        name: 'fixture-checkout',
        taxCategory: 'saas',
      });
      createdProductIds.add(fixtureProduct.id);

      fixturePrice = await provider.prices.create({
        productId: fixtureProduct.id,
        currency: 'usd',
        kind: 'one_time',
        unitAmount: 1999,
      });
      createdPriceIds.add(fixturePrice.id);

      fixtureCustomer = await provider.customers.create({});
      createdCustomerIds.add(fixtureCustomer.id);
    });

    // -------------------------------------------------------------------------
    // checkout.createSession
    // -------------------------------------------------------------------------
    describe('checkout.createSession', () => {
      it('returns a session with sensible defaults for a minimal input', async () => {
        const s = await provider.checkout.createSession({
          lineItems: [{ priceId: fixturePrice.id, quantity: 1 }],
          successUrl: 'https://example.com/success',
        });
        expectIsCheckoutSession(s);
        expect(s.status).toBe('open');
        expect(s.lineItems).toEqual([{ priceId: fixturePrice.id, quantity: 1 }]);
        expect(s.successUrl).toBe('https://example.com/success');
        expect(s.cancelUrl).toBeNull();
        expect(s.customerId).toBeNull();
        expect(s.metadata).toEqual({});
        expect(s.createdAt).toBeInstanceOf(Date);
      });

      it('round-trips customerId, cancelUrl, and metadata', async () => {
        const metadata = { ref: 'X' };
        const s = await provider.checkout.createSession({
          lineItems: [{ priceId: fixturePrice.id, quantity: 1 }],
          successUrl: 'https://example.com/success',
          cancelUrl: 'https://example.com/cancel',
          customerId: fixtureCustomer.id,
          metadata,
        });
        expectIsCheckoutSession(s);
        expect(s.customerId).toBe(fixtureCustomer.id);
        expect(s.cancelUrl).toBe('https://example.com/cancel');
        expect(s.successUrl).toBe('https://example.com/success');
        expect(s.metadata).toEqual(metadata);
      });

      it('accepts discount:{kind:"allowPromotionCodes"}', async () => {
        const s = await provider.checkout.createSession({
          lineItems: [{ priceId: fixturePrice.id, quantity: 1 }],
          successUrl: 'https://example.com/success',
          discount: { kind: 'allowPromotionCodes' },
        });
        expectIsCheckoutSession(s);
        expect(s.status).toBe('open');
      });

      it('preserves multiple lineItems in order', async () => {
        const second = await provider.prices.create({
          productId: fixtureProduct.id,
          currency: 'usd',
          kind: 'one_time',
          unitAmount: 500,
        });
        createdPriceIds.add(second.id);

        const lineItems = [
          { priceId: fixturePrice.id, quantity: 2 },
          { priceId: second.id, quantity: 3 },
        ];
        const s = await provider.checkout.createSession({
          lineItems,
          successUrl: 'https://example.com/success',
        });
        expectIsCheckoutSession(s);
        expect(s.lineItems).toEqual(lineItems);
      });

      it('after createSession, getSession returns an equivalent session', async () => {
        const s = await provider.checkout.createSession({
          lineItems: [{ priceId: fixturePrice.id, quantity: 1 }],
          successUrl: 'https://example.com/success',
          cancelUrl: 'https://example.com/cancel',
          metadata: { trace: 'abc' },
        });
        expectIsCheckoutSession(s);
        const got = await provider.checkout.getSession({ id: s.id });
        expect(got).not.toBeNull();
        const g = got as ProviderCheckoutSession;
        expect(g.id).toBe(s.id);
        expect(g.lineItems).toEqual(s.lineItems);
        expect(g.successUrl).toBe(s.successUrl);
        expect(g.cancelUrl).toBe(s.cancelUrl);
        expect(g.metadata).toEqual(s.metadata);
        expect(g.createdAt.getTime()).toBe(s.createdAt.getTime());
      });

      it('two creates with the same input yield distinct sessions', async () => {
        const input = {
          lineItems: [{ priceId: fixturePrice.id, quantity: 1 }],
          successUrl: 'https://example.com/success',
        };
        const a = await provider.checkout.createSession(input);
        const b = await provider.checkout.createSession(input);
        expect(a.id).not.toBe(b.id);
      });

      // ---- validation: input shape ----
      it.each([
        ['undefined', undefined],
        ['null', null],
        ['string', 'foo'],
        ['number', 42],
        ['boolean', true],
      ])('rejects non-object input (%s)', async (_l, value) => {
        await expect(provider.checkout.createSession(value as any)).rejects.toBeInstanceOf(
          ProviderValidationError,
        );
      });

      // ---- validation: lineItems ----
      it.each([
        ['missing', {}],
        ['non-array', { lineItems: 'oops' }],
        ['empty array', { lineItems: [] }],
        ['null', { lineItems: null }],
      ])('rejects invalid lineItems (%s)', async (_l, override) => {
        await expect(
          provider.checkout.createSession({
            successUrl: 'https://example.com/success',
            ...(override as any),
          } as any),
        ).rejects.toBeInstanceOf(ProviderValidationError);
      });

      // ---- validation: lineItems[0].priceId ----
      it.each([
        ['missing', { quantity: 1 }],
        ['empty', { priceId: '', quantity: 1 }],
        ['number', { priceId: 42 as any, quantity: 1 }],
        ['null', { priceId: null as any, quantity: 1 }],
      ])('rejects invalid lineItem priceId (%s)', async (_l, item) => {
        await expect(
          provider.checkout.createSession({
            lineItems: [item as any],
            successUrl: 'https://example.com/success',
          } as any),
        ).rejects.toBeInstanceOf(ProviderValidationError);
      });

      // ---- validation: lineItems[0].quantity ----
      it.each([
        ['missing', { priceId: 'price_x' }],
        ['zero', { priceId: 'price_x', quantity: 0 }],
        ['negative', { priceId: 'price_x', quantity: -1 }],
        ['fractional', { priceId: 'price_x', quantity: 1.5 }],
        ['string', { priceId: 'price_x', quantity: '1' }],
        ['null', { priceId: 'price_x', quantity: null }],
      ])('rejects invalid lineItem quantity (%s)', async (_l, item) => {
        await expect(
          provider.checkout.createSession({
            lineItems: [item as any],
            successUrl: 'https://example.com/success',
          } as any),
        ).rejects.toBeInstanceOf(ProviderValidationError);
      });

      // ---- validation: successUrl ----
      it.each([
        ['missing', undefined],
        ['empty', ''],
        ['number', 42],
        ['not-a-url', 'not-a-url'],
        ['relative path', '/success'],
        ['null', null],
      ])('rejects invalid successUrl (%s)', async (_l, value) => {
        const input: Record<string, unknown> = {
          lineItems: [{ priceId: fixturePrice.id, quantity: 1 }],
        };
        if (value !== undefined) input.successUrl = value;
        await expect(provider.checkout.createSession(input as any)).rejects.toBeInstanceOf(
          ProviderValidationError,
        );
      });

      // ---- validation: cancelUrl ----
      it.each([
        ['empty', ''],
        ['not-a-url', 'not-a-url'],
        ['relative path', '/cancel'],
        ['number', 42],
      ])('rejects invalid cancelUrl (%s)', async (_l, value) => {
        await expect(
          provider.checkout.createSession({
            lineItems: [{ priceId: fixturePrice.id, quantity: 1 }],
            successUrl: 'https://example.com/success',
            cancelUrl: value as any,
          } as any),
        ).rejects.toBeInstanceOf(ProviderValidationError);
      });

      // ---- validation: customerId ----
      it.each([
        ['empty', ''],
        ['number', 42],
        ['boolean', true],
        ['object', { x: 1 }],
      ])('rejects invalid customerId (%s)', async (_l, value) => {
        await expect(
          provider.checkout.createSession({
            lineItems: [{ priceId: fixturePrice.id, quantity: 1 }],
            successUrl: 'https://example.com/success',
            customerId: value as any,
          } as any),
        ).rejects.toBeInstanceOf(ProviderValidationError);
      });

      // ---- validation: discount ----
      it.each([
        ['unknown kind', { kind: 'unknown' }],
        ['discountId without id', { kind: 'discountId' }],
        ['discountId empty', { kind: 'discountId', discountId: '' }],
        ['code empty', { kind: 'code', code: '' }],
        ['combined keys', { kind: 'discountId', discountId: 'd1', code: 'X' }],
      ])('rejects invalid discount (%s)', async (_l, discount) => {
        await expect(
          provider.checkout.createSession({
            lineItems: [{ priceId: fixturePrice.id, quantity: 1 }],
            successUrl: 'https://example.com/success',
            discount: discount as any,
          } as any),
        ).rejects.toBeInstanceOf(ProviderValidationError);
      });

      // ---- validation: metadata ----
      it.each([
        ['number', 42],
        ['string', 'foo'],
        ['array', [['k', 'v']]],
      ])('rejects non-object metadata (%s)', async (_l, value) => {
        await expect(
          provider.checkout.createSession({
            lineItems: [{ priceId: fixturePrice.id, quantity: 1 }],
            successUrl: 'https://example.com/success',
            metadata: value as any,
          } as any),
        ).rejects.toBeInstanceOf(ProviderValidationError);
      });

      it.each([
        ['number value', { x: 1 }],
        ['null value', { x: null }],
        ['nested object', { x: { y: 'z' } }],
      ])('rejects metadata with non-string values (%s)', async (_l, metadata) => {
        await expect(
          provider.checkout.createSession({
            lineItems: [{ priceId: fixturePrice.id, quantity: 1 }],
            successUrl: 'https://example.com/success',
            metadata: metadata as any,
          } as any),
        ).rejects.toBeInstanceOf(ProviderValidationError);
      });

      // ---- collision ----
      it('throws MetadataCollisionError (422) for reserved __provider_ keys', async () => {
        const err = await provider.checkout
          .createSession({
            lineItems: [{ priceId: fixturePrice.id, quantity: 1 }],
            successUrl: 'https://example.com/success',
            metadata: { __provider_secret: 'x' } as any,
          })
          .then(
            () => null,
            (e: unknown) => e,
          );
        expect(err).toBeInstanceOf(MetadataCollisionError);
        expect((err as MetadataCollisionError).status).toBe(422);
      });

      // ---- constraint cases ----
      it('discount.discountId unknown → ProviderNotFoundError(404) or ProviderConstraintError(422)', async () => {
        const err = await provider.checkout
          .createSession({
            lineItems: [{ priceId: fixturePrice.id, quantity: 1 }],
            successUrl: 'https://example.com/success',
            discount: {
              kind: 'discountId',
              discountId: 'disc_does_not_exist_xyz_123',
            },
          })
          .then(
            () => null,
            (e: unknown) => e,
          );
        expect(err instanceof ProviderNotFoundError || err instanceof ProviderConstraintError).toBe(
          true,
        );
        if (err instanceof ProviderNotFoundError) {
          expect(err.status).toBe(404);
        } else if (err instanceof ProviderConstraintError) {
          expect(err.status).toBe(422);
        }
      });

      it('discount.code unknown → ProviderNotFoundError(404) or ProviderConstraintError(422)', async () => {
        const err = await provider.checkout
          .createSession({
            lineItems: [{ priceId: fixturePrice.id, quantity: 1 }],
            successUrl: 'https://example.com/success',
            discount: { kind: 'code', code: 'CODE_DOES_NOT_EXIST_XYZ_123' },
          })
          .then(
            () => null,
            (e: unknown) => e,
          );
        expect(err instanceof ProviderNotFoundError || err instanceof ProviderConstraintError).toBe(
          true,
        );
        if (err instanceof ProviderNotFoundError) {
          expect(err.status).toBe(404);
        } else if (err instanceof ProviderConstraintError) {
          expect(err.status).toBe(422);
        }
      });

      it('quantity outside the price quantity bounds → ProviderConstraintError(422)', async () => {
        const boundedPrice = await provider.prices.create({
          productId: fixtureProduct.id,
          currency: 'usd',
          kind: 'one_time',
          unitAmount: 100,
          quantity: { min: 2, max: 5 },
        });
        createdPriceIds.add(boundedPrice.id);

        const err = await provider.checkout
          .createSession({
            lineItems: [{ priceId: boundedPrice.id, quantity: 1 }],
            successUrl: 'https://example.com/success',
          })
          .then(
            () => null,
            (e: unknown) => e,
          );
        expect(err).toBeInstanceOf(ProviderConstraintError);
        expect((err as ProviderConstraintError).status).toBe(422);
      });
    });

    // -------------------------------------------------------------------------
    // checkout.getSession
    // -------------------------------------------------------------------------
    describe('checkout.getSession', () => {
      it('returns an equivalent session after createSession', async () => {
        const s = await provider.checkout.createSession({
          lineItems: [{ priceId: fixturePrice.id, quantity: 1 }],
          successUrl: 'https://example.com/success',
        });
        const got = await provider.checkout.getSession({ id: s.id });
        expect(got).not.toBeNull();
        const g = got as ProviderCheckoutSession;
        expectIsCheckoutSession(g);
        expect(g.id).toBe(s.id);
        expect(g.lineItems).toEqual(s.lineItems);
        expect(g.successUrl).toBe(s.successUrl);
        expect(g.cancelUrl).toBe(s.cancelUrl);
        expect(g.metadata).toEqual(s.metadata);
        expect(g.createdAt.getTime()).toBe(s.createdAt.getTime());
      });

      it('returns null (does not throw) for a missing id', async () => {
        const got = await provider.checkout.getSession({ id: 'sess_does_not_exist_xyz' });
        expect(got).toBeNull();
      });

      // ---- validation: id field ----
      it.each([
        ['missing', {}],
        ['empty', { id: '' }],
        ['null', { id: null as any }],
        ['number', { id: 42 as any }],
        ['boolean', { id: true as any }],
      ])('rejects invalid id (%s)', async (_l, input) => {
        await expect(provider.checkout.getSession(input as any)).rejects.toBeInstanceOf(
          ProviderValidationError,
        );
      });

      // ---- validation: input shape ----
      it.each([
        ['null', null],
        ['undefined', undefined],
        ['string', 'sess_x'],
        ['number', 42],
      ])('rejects non-object input (%s)', async (_l, value) => {
        await expect(provider.checkout.getSession(value as any)).rejects.toBeInstanceOf(
          ProviderValidationError,
        );
      });
    });

    // -------------------------------------------------------------------------
    // Best-effort cleanup: archive every fixture we created and run the
    // harness teardown. Failures are swallowed so a flaky cleanup never masks
    // a real test failure.
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
