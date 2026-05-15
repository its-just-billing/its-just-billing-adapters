import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ProviderNotSupportedError } from '../../../errors/index.js';
import type { BillingProvider, ProviderProduct, TaxCategory } from '../../../index.js';
import type { ProviderTestHarness } from '../../harness.js';

/**
 * Registers the capabilities automated conformance suite. The brief here is
 * the static-shape contract for `BillingProvider.capabilities` plus the
 * "not-supported" defense-at-call-time guarantee promised by
 * `ProviderNotSupportedError`.
 */
export function registerCapabilitiesAutomatedSuite(
  label: string,
  factory: () => ProviderTestHarness | Promise<ProviderTestHarness>,
): void {
  // ---------------------------------------------------------------------------
  // Helpers (intentionally inlined per the convention used elsewhere in the
  // automated suite — no shared util library yet).
  // ---------------------------------------------------------------------------

  /** All 9 normalized TaxCategory enum values. */
  const ALL_TAX_CATEGORIES: readonly TaxCategory[] = [
    'digital_goods',
    'ebooks',
    'implementation_services',
    'professional_services',
    'saas',
    'software_programming_services',
    'standard',
    'training_services',
    'website_hosting',
  ];

  /** A representative slate of lowercase ISO-4217 currency codes. */
  const KNOWN_CURRENCIES: readonly string[] = [
    'usd',
    'eur',
    'gbp',
    'jpy',
    'cad',
    'aud',
    'chf',
    'cny',
    'inr',
    'brl',
    'sek',
    'nok',
    'dkk',
    'sgd',
    'hkd',
    'nzd',
    'mxn',
    'zar',
  ];

  /**
   * Loose Set-like duck-type check. We deliberately don't require
   * `instanceof Set` so adapters are free to return any ReadonlySet
   * implementation. `has` + iterability are the only contract.
   */
  function isSetLike(obj: unknown): obj is ReadonlySet<unknown> {
    if (obj === null || typeof obj !== 'object') return false;
    const rec = obj as Record<string, unknown>;
    return 'has' in rec && typeof rec.has === 'function' && Symbol.iterator in (rec as object);
  }

  function uniqueName(prefix = 'cap-fixture'): string {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  // ---------------------------------------------------------------------------
  // Outer describe — acquires harness once.
  // ---------------------------------------------------------------------------

  describe(`capabilities [${label}]`, () => {
    let harness: ProviderTestHarness;
    let provider: BillingProvider;
    const createdProductIds = new Set<string>();
    const createdPriceIds = new Set<string>();

    beforeAll(async () => {
      harness = await factory();
      provider = harness.provider;
    });

    // -------------------------------------------------------------------------
    // Shape: `capabilities` is present and well-formed.
    // -------------------------------------------------------------------------
    describe('shape', () => {
      it('exposes a defined capabilities object', () => {
        expect(provider.capabilities).toBeDefined();
        expect(typeof provider.capabilities).toBe('object');
        expect(provider.capabilities).not.toBeNull();
      });

      it('capabilities.taxCategories is a non-empty Set-like collection', () => {
        const tc = provider.capabilities.taxCategories;
        expect(isSetLike(tc)).toBe(true);
        expect(tc.size).toBeGreaterThan(0);
      });

      it('every value in capabilities.taxCategories is a normalized TaxCategory', () => {
        const valid = new Set<string>(ALL_TAX_CATEGORIES);
        for (const value of provider.capabilities.taxCategories) {
          expect(typeof value).toBe('string');
          expect(valid.has(value as string)).toBe(true);
        }
      });

      it('capabilities.currencies is a non-empty Set-like collection', () => {
        const cur = provider.capabilities.currencies;
        expect(isSetLike(cur)).toBe(true);
        expect(cur.size).toBeGreaterThan(0);
      });

      it('every currency in capabilities.currencies is lowercase ISO-4217 (3 letters)', () => {
        for (const value of provider.capabilities.currencies) {
          expect(typeof value).toBe('string');
          expect(value as string).toMatch(/^[a-z]{3}$/);
        }
      });
    });

    // -------------------------------------------------------------------------
    // Not-supported boundary: products.create with an out-of-set tax category
    // throws ProviderNotSupportedError(422, 'not_supported') with the
    // offending value/feature attached.
    // -------------------------------------------------------------------------
    describe('not-supported: taxCategory', () => {
      it('throws ProviderNotSupportedError for a TaxCategory outside provider.capabilities.taxCategories', async () => {
        const supported = provider.capabilities.taxCategories;
        const unsupported = ALL_TAX_CATEGORIES.find((tc) => !supported.has(tc));
        if (unsupported === undefined) {
          // The provider supports every normalized TaxCategory — nothing to
          // exercise. Early return rather than skip, per brief.
          return;
        }
        const err = await provider.products
          .create({ name: uniqueName(), taxCategory: unsupported })
          .then(
            () => null,
            (e: unknown) => e,
          );
        expect(err).toBeInstanceOf(ProviderNotSupportedError);
        const e = err as ProviderNotSupportedError;
        expect(e.status).toBe(422);
        expect(e.code).toBe('not_supported');
        expect(e.feature).toBe('taxCategory');
        expect(e.value).toBe(unsupported);
      });
    });

    // -------------------------------------------------------------------------
    // Not-supported boundary: prices.create with an out-of-set currency
    // throws ProviderNotSupportedError(422, 'not_supported') with the
    // offending value/feature attached.
    // -------------------------------------------------------------------------
    describe('not-supported: currency', () => {
      let fixtureProduct: ProviderProduct | null = null;

      it('throws ProviderNotSupportedError for a currency outside provider.capabilities.currencies', async () => {
        const supported = provider.capabilities.currencies;
        const unsupported = KNOWN_CURRENCIES.find((c) => !supported.has(c));
        if (unsupported === undefined) {
          // The provider supports every currency in our representative slate.
          // Early return rather than skip, per brief.
          return;
        }

        // Build a fixture product so the price create has somewhere to attach.
        fixtureProduct = await provider.products.create({
          name: uniqueName('cap-currency'),
          taxCategory: 'saas',
        });
        createdProductIds.add(fixtureProduct.id);
        await harness.assertConsistency?.product?.(fixtureProduct);

        const err = await provider.prices
          .create({
            productId: fixtureProduct.id,
            currency: unsupported,
            kind: 'one_time',
            unitAmount: 1000,
          })
          .then(
            () => null,
            (e: unknown) => e,
          );
        expect(err).toBeInstanceOf(ProviderNotSupportedError);
        const e = err as ProviderNotSupportedError;
        expect(e.status).toBe(422);
        expect(e.code).toBe('not_supported');
        expect(e.feature).toBe('currency');
        expect(e.value).toBe(unsupported);
      });
    });

    // -------------------------------------------------------------------------
    // Best-effort cleanup.
    // -------------------------------------------------------------------------
    afterAll(async () => {
      // Prices first so products can be hard-deleted (Stripe rejects product
      // deletion when prices are attached).
      for (const id of createdPriceIds) {
        try {
          await harness?.cleanupResource?.('price', id);
        } catch {}
        try {
          await provider.prices.deactivate({ id });
        } catch {
          // Ignore cleanup failures.
        }
      }
      for (const id of createdProductIds) {
        try {
          await harness?.cleanupResource?.('product', id);
        } catch {}
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
