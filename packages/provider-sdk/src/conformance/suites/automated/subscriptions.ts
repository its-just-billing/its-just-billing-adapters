import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { BillingProvider, ProviderCustomer } from '../../../index.js';
import {
  ProviderValidationError,
  ProviderNotFoundError,
} from '../../../errors/index.js';
import type { ProviderTestHarness } from '../../harness.js';

/**
 * Registers the subscriptions automated conformance suite. All scenarios in
 * the subscriptions brief that do NOT require a real subscription to exist
 * are encoded here. Happy-path scenarios that need a live subscription live
 * in the self-setup suite (gated on `harness.setup.createSubscription`).
 *
 * The brief is the source of truth; this file is the spec.
 */
export function registerSubscriptionsAutomatedSuite(
  label: string,
  factory: () => ProviderTestHarness | Promise<ProviderTestHarness>,
): void {
  // ---------------------------------------------------------------------------
  // Outer describe — acquires harness once, registers per-method describes.
  // ---------------------------------------------------------------------------

  describe(`subscriptions [${label}]`, () => {
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
    // subscriptions.list
    // -------------------------------------------------------------------------
    describe('subscriptions.list', () => {
      it('returns [] for a fresh customer with no subscriptions', async () => {
        const customer: ProviderCustomer = await provider.customers.create({});
        trackCustomer(customer.id);
        const out = await provider.subscriptions.list({ customerId: customer.id });
        expect(Array.isArray(out)).toBe(true);
        expect(out).toEqual([]);
      });

      it('returns [] (does not throw) for a non-existent customerId', async () => {
        const out = await provider.subscriptions.list({
          customerId: 'cus_does_not_exist_xyz',
        });
        expect(Array.isArray(out)).toBe(true);
        expect(out).toEqual([]);
      });

      // ---- validation: customerId ----
      it.each([
        ['missing', {}],
        ['empty string', { customerId: '' }],
        ['null', { customerId: null as any }],
        ['number', { customerId: 42 as any }],
        ['boolean', { customerId: true as any }],
        ['object', { customerId: { x: 1 } as any }],
      ])('rejects invalid customerId (%s)', async (_label, input) => {
        await expect(
          provider.subscriptions.list(input as any),
        ).rejects.toBeInstanceOf(ProviderValidationError);
      });

      // ---- validation: status ----
      it.each([
        ['paused (not in enum)', 'paused'],
        ['PAUSED (wrong case)', 'PAUSED'],
        ['number', 123],
      ])('rejects invalid status (%s)', async (_label, value) => {
        await expect(
          provider.subscriptions.list({
            customerId: 'cus_x',
            status: value as any,
          }),
        ).rejects.toBeInstanceOf(ProviderValidationError);
      });

      // ---- validation: cursor ----
      it.each([
        ['empty', ''],
        ['number', 42],
        ['boolean', true],
        ['object', { x: 1 }],
      ])('rejects invalid cursor (%s)', async (_label, value) => {
        await expect(
          provider.subscriptions.list({
            customerId: 'cus_x',
            cursor: value as any,
          }),
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
      ])('rejects invalid limit (%s)', async (_label, value) => {
        await expect(
          provider.subscriptions.list({
            customerId: 'cus_x',
            limit: value as any,
          }),
        ).rejects.toBeInstanceOf(ProviderValidationError);
      });
    });

    // -------------------------------------------------------------------------
    // subscriptions.get
    // -------------------------------------------------------------------------
    describe('subscriptions.get', () => {
      it('returns null (does not throw) for a missing id', async () => {
        const got = await provider.subscriptions.get({ id: 'sub_does_not_exist_xyz' });
        expect(got).toBeNull();
      });

      // ---- validation: input shape ----
      it.each([
        ['null', null],
        ['string', 'sub_123'],
        ['number', 42],
        ['boolean', true],
      ])('rejects non-object input (%s)', async (_label, value) => {
        await expect(provider.subscriptions.get(value as any)).rejects.toBeInstanceOf(
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
        ['object', { id: { x: 1 } as any }],
      ])('rejects invalid id (%s)', async (_label, input) => {
        await expect(provider.subscriptions.get(input as any)).rejects.toBeInstanceOf(
          ProviderValidationError,
        );
      });
    });

    // -------------------------------------------------------------------------
    // subscriptions.cancel
    // -------------------------------------------------------------------------
    describe('subscriptions.cancel', () => {
      it('throws ProviderNotFoundError (404) for a missing id', async () => {
        const err = await provider.subscriptions
          .cancel({ id: 'sub_missing_xyz' } as any)
          .then(
            () => null,
            (e: unknown) => e,
          );
        expect(err).toBeInstanceOf(ProviderNotFoundError);
        expect((err as ProviderNotFoundError).status).toBe(404);
      });

      // ---- validation: id ----
      it.each([
        ['missing', {}],
        ['empty', { id: '' }],
        ['null', { id: null }],
        ['number', { id: 42 }],
        ['boolean', { id: true }],
      ])('rejects invalid id (%s)', async (_label, input) => {
        await expect(provider.subscriptions.cancel(input as any)).rejects.toBeInstanceOf(
          ProviderValidationError,
        );
      });

      // ---- validation: when ----
      it.each([
        ['now', 'now'],
        ['end_of_period', 'end_of_period'],
        ['empty', ''],
        ['boolean', true],
        ['number', 42],
      ])('rejects invalid when (%s)', async (_label, value) => {
        await expect(
          provider.subscriptions.cancel({ id: 'sub_x', when: value as any }),
        ).rejects.toBeInstanceOf(ProviderValidationError);
      });
    });

    // -------------------------------------------------------------------------
    // subscriptions.change
    // -------------------------------------------------------------------------
    describe('subscriptions.change', () => {
      it('throws ProviderNotFoundError (404) for a missing id', async () => {
        const err = await provider.subscriptions
          .change({
            id: 'sub_missing_xyz',
            items: [{ priceId: 'price_x' }],
          } as any)
          .then(
            () => null,
            (e: unknown) => e,
          );
        expect(err).toBeInstanceOf(ProviderNotFoundError);
        expect((err as ProviderNotFoundError).status).toBe(404);
      });

      // ---- validation: id ----
      it.each([
        ['missing', { items: [{ priceId: 'price_x' }] }],
        ['empty', { id: '', items: [{ priceId: 'price_x' }] }],
        ['null', { id: null as any, items: [{ priceId: 'price_x' }] }],
        ['number', { id: 42 as any, items: [{ priceId: 'price_x' }] }],
        ['boolean', { id: true as any, items: [{ priceId: 'price_x' }] }],
      ])('rejects invalid id (%s)', async (_label, input) => {
        await expect(provider.subscriptions.change(input as any)).rejects.toBeInstanceOf(
          ProviderValidationError,
        );
      });

      // ---- validation: items ----
      it.each([
        ['missing', { id: 'sub_x' }],
        ['empty array', { id: 'sub_x', items: [] }],
        ['not an array (object)', { id: 'sub_x', items: { priceId: 'price_x' } as any }],
        ['not an array (string)', { id: 'sub_x', items: 'price_x' as any }],
        ['null', { id: 'sub_x', items: null as any }],
      ])('rejects invalid items (%s)', async (_label, input) => {
        await expect(provider.subscriptions.change(input as any)).rejects.toBeInstanceOf(
          ProviderValidationError,
        );
      });

      // ---- validation: items[0].priceId ----
      it.each([
        ['missing', { id: 'sub_x', items: [{} as any] }],
        ['empty', { id: 'sub_x', items: [{ priceId: '' }] }],
        ['null', { id: 'sub_x', items: [{ priceId: null as any }] }],
        ['number', { id: 'sub_x', items: [{ priceId: 42 as any }] }],
        ['boolean', { id: 'sub_x', items: [{ priceId: true as any }] }],
      ])('rejects invalid items[0].priceId (%s)', async (_label, input) => {
        await expect(provider.subscriptions.change(input as any)).rejects.toBeInstanceOf(
          ProviderValidationError,
        );
      });

      // ---- validation: items[0].quantity ----
      it.each([
        ['zero', 0],
        ['negative', -1],
        ['fractional', 1.5],
        ['string', '1'],
        ['boolean', true],
      ])('rejects invalid items[0].quantity (%s)', async (_label, value) => {
        await expect(
          provider.subscriptions.change({
            id: 'sub_x',
            items: [{ priceId: 'price_x', quantity: value as any }],
          } as any),
        ).rejects.toBeInstanceOf(ProviderValidationError);
      });

      // ---- validation: items[0] not an object ----
      it.each([
        ['string', 'price_x'],
        ['number', 42],
        ['null', null],
        ['array', ['price_x']],
      ])('rejects non-object items[0] (%s)', async (_label, value) => {
        await expect(
          provider.subscriptions.change({
            id: 'sub_x',
            items: [value as any],
          } as any),
        ).rejects.toBeInstanceOf(ProviderValidationError);
      });

      // ---- validation: when ----
      it.each([
        ['now', 'now'],
        ['end_of_period', 'end_of_period'],
        ['empty', ''],
        ['number', 42],
      ])('rejects invalid when (%s)', async (_label, value) => {
        await expect(
          provider.subscriptions.change({
            id: 'sub_x',
            items: [{ priceId: 'price_x' }],
            when: value as any,
          } as any),
        ).rejects.toBeInstanceOf(ProviderValidationError);
      });

      // ---- validation: prorationBehavior ----
      it.each([
        ['bogus', 'always'],
        ['empty', ''],
        ['number', 42],
        ['boolean', true],
      ])('rejects invalid prorationBehavior (%s)', async (_label, value) => {
        await expect(
          provider.subscriptions.change({
            id: 'sub_x',
            items: [{ priceId: 'price_x' }],
            prorationBehavior: value as any,
          } as any),
        ).rejects.toBeInstanceOf(ProviderValidationError);
      });
    });

    // -------------------------------------------------------------------------
    // subscriptions.cancelScheduledChange
    // -------------------------------------------------------------------------
    describe('subscriptions.cancelScheduledChange', () => {
      it('throws ProviderNotFoundError (404) for a missing id', async () => {
        const err = await provider.subscriptions
          .cancelScheduledChange({ id: 'sub_missing_xyz' })
          .then(
            () => null,
            (e: unknown) => e,
          );
        expect(err).toBeInstanceOf(ProviderNotFoundError);
        expect((err as ProviderNotFoundError).status).toBe(404);
      });

      // ---- validation: input shape ----
      it.each([
        ['null', null],
        ['string', 'sub_x'],
        ['number', 42],
        ['boolean', true],
      ])('rejects non-object input (%s)', async (_label, value) => {
        await expect(
          provider.subscriptions.cancelScheduledChange(value as any),
        ).rejects.toBeInstanceOf(ProviderValidationError);
      });

      // ---- validation: id ----
      it.each([
        ['missing', {}],
        ['empty', { id: '' }],
        ['null', { id: null as any }],
        ['number', { id: 42 as any }],
        ['boolean', { id: true as any }],
      ])('rejects invalid id (%s)', async (_label, input) => {
        await expect(
          provider.subscriptions.cancelScheduledChange(input as any),
        ).rejects.toBeInstanceOf(ProviderValidationError);
      });
    });

    // -------------------------------------------------------------------------
    // Best-effort cleanup. Subscriptions themselves are not created here, but
    // we archive any customers we created.
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
