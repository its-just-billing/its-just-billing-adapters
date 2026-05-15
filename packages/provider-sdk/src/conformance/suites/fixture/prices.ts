import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { BillingProvider, ProviderPrice } from '../../../index.js';
import type { Metadata } from '../../../models/metadata.js';
import type { Quantity } from '../../../models/quantity.js';
import { withFixture } from '../../fixture-runner.js';
import type { ProviderTestHarness } from '../../harness.js';
import { lazySkipIf, requireFixture } from '../../skip-if.js';

/**
 * Registers the prices fixture-tier conformance suite. Each scenario targets a
 * pre-provisioned price (recurring or one-time) at
 * `harness.fixtures.recurringPriceId` / `harness.fixtures.oneTimePriceId`,
 * asserts the fixture is in a clean starting state, exercises a reversible
 * write, then restores the captured snapshot.
 *
 * Immutable fields (productId, currency, kind, unitAmount, and for recurring
 * interval + intervalCount) are never modified by these scenarios. Every write
 * (test and revert) is followed by `harness.assertConsistency?.price?.(...)`
 * on the narrowed non-null result.
 */
export function registerPricesFixtureSuite(
  label: string,
  factory: () => ProviderTestHarness | Promise<ProviderTestHarness>,
): void {
  // ---------------------------------------------------------------------------
  // Inlined helpers — fixture suites avoid an external util layer.
  // ---------------------------------------------------------------------------

  function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  /** Structural deep-equal for the small JSON-ish shapes used here. */
  function deepEqual(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (typeof a !== typeof b) return false;
    if (a === null || b === null) return a === b;
    if (Array.isArray(a) || Array.isArray(b)) {
      if (!Array.isArray(a) || !Array.isArray(b)) return false;
      if (a.length !== b.length) return false;
      for (let i = 0; i < a.length; i += 1) {
        if (!deepEqual(a[i], b[i])) return false;
      }
      return true;
    }
    if (isPlainObject(a) && isPlainObject(b)) {
      const ak = Object.keys(a);
      const bk = Object.keys(b);
      if (ak.length !== bk.length) return false;
      for (const k of ak) {
        if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
        if (!deepEqual(a[k], (b as Record<string, unknown>)[k])) return false;
      }
      return true;
    }
    return false;
  }

  function expectDeepEqual(actual: unknown, expected: unknown, message?: string): void {
    expect(deepEqual(actual, expected), message).toBe(true);
  }

  function expectNoProviderKeys(metadata: Metadata): void {
    for (const k of Object.keys(metadata)) {
      expect(k.startsWith('__provider_')).toBe(false);
    }
  }

  /**
   * Assert that the immutable shape of `actual` matches the snapshot. Covers
   * productId, currency, kind, unitAmount, and (for recurring) interval +
   * intervalCount.
   */
  function expectImmutablesUnchanged(actual: ProviderPrice, snapshot: ProviderPrice): void {
    expect(actual.productId).toBe(snapshot.productId);
    expect(actual.currency).toBe(snapshot.currency);
    expect(actual.kind).toBe(snapshot.kind);
    if (actual.kind === 'recurring' && snapshot.kind === 'recurring') {
      expect(actual.unitAmount).toBe(snapshot.unitAmount);
      expect(actual.interval).toBe(snapshot.interval);
      expect(actual.intervalCount).toBe(snapshot.intervalCount);
    } else if (actual.kind === 'one_time' && snapshot.kind === 'one_time') {
      expect(actual.unitAmount).toBe(snapshot.unitAmount);
    }
  }

  /**
   * Run a fixture scenario against the recurring or one-time price. Captures
   * original metadata + quantity in the healthCheck closure and supplies them
   * back to the test body. The revert always rewrites metadata + quantity to
   * the snapshot values, and re-activates if the test left the price inactive
   * — both writes go through `assertConsistency.price` on the narrowed result.
   */
  async function runPriceScenario(
    provider: BillingProvider,
    harness: ProviderTestHarness,
    id: string,
    expectedKind: 'recurring' | 'one_time',
    body: (ctx: {
      snapshot: ProviderPrice;
      originalMetadata: Metadata;
      originalQuantity: Quantity;
    }) => Promise<void>,
  ): Promise<void> {
    let snapshot: ProviderPrice | null = null;
    let originalMetadata: Metadata = {};
    let originalQuantity: Quantity = { min: 1 };

    await withFixture(`price:${id}`, {
      healthCheck: async () => {
        const got = await provider.prices.get({ id });
        if (got === null) {
          throw new Error(`price fixture ${id} not found`);
        }
        if (got.active !== true) {
          throw new Error(`price fixture ${id} is not active`);
        }
        if (got.kind !== expectedKind) {
          throw new Error(`price fixture ${id} has kind="${got.kind}"; expected "${expectedKind}"`);
        }
        snapshot = got;
        // Defensive shallow copy so the snapshot's references aren't mutated.
        originalMetadata = { ...got.metadata };
        originalQuantity = { ...got.quantity };
      },
      test: async () => {
        await body({
          snapshot: snapshot as unknown as ProviderPrice,
          originalMetadata,
          originalQuantity,
        });
      },
      revert: async () => {
        // Universal revert: rewrite metadata + quantity back to the snapshot.
        const reverted = await provider.prices.update({
          id,
          metadata: originalMetadata,
          quantity: originalQuantity,
        });
        expect(reverted).not.toBeNull();
        const r = reverted as ProviderPrice;
        await harness.assertConsistency?.price?.(r);
        expectDeepEqual(r.metadata, originalMetadata);
        expectDeepEqual(r.quantity, originalQuantity);

        // Re-activate if the test left the price inactive.
        if (r.active !== true) {
          const reactivated = await provider.prices.activate({ id });
          expect(reactivated).not.toBeNull();
          const a = reactivated as ProviderPrice;
          await harness.assertConsistency?.price?.(a);
          expect(a.active).toBe(true);
        }
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Outer describe — acquires harness once, registers per-scenario tests.
  // ---------------------------------------------------------------------------

  describe(`prices [${label}]`, () => {
    let harness!: ProviderTestHarness;
    let provider!: BillingProvider;

    beforeAll(async () => {
      harness = await factory();
      provider = harness.provider;
    });

    // -------------------------------------------------------------------------
    // Scenario 1: deactivate + activate (recurring)
    // -------------------------------------------------------------------------
    lazySkipIf(() => !harness?.fixtures?.recurringPriceId)(
      'scenario 1: deactivate + activate (recurring)',
      async () => {
        const id = requireFixture(harness.fixtures?.recurringPriceId, 'recurringPriceId');
        await runPriceScenario(
          provider,
          harness,
          id,
          'recurring',
          async ({ snapshot, originalMetadata, originalQuantity }) => {
            const deactivated = await provider.prices.deactivate({ id });
            expect(deactivated).not.toBeNull();
            const d = deactivated as ProviderPrice;
            await harness.assertConsistency?.price?.(d);
            expect(d.id).toBe(id);
            expect(d.active).toBe(false);
            expectImmutablesUnchanged(d, snapshot);
            expectDeepEqual(d.metadata, originalMetadata);
            expectDeepEqual(d.quantity, originalQuantity);

            const refetched = await provider.prices.get({ id });
            expect(refetched).not.toBeNull();
            expect((refetched as ProviderPrice).active).toBe(false);

            const reactivated = await provider.prices.activate({ id });
            expect(reactivated).not.toBeNull();
            const a = reactivated as ProviderPrice;
            await harness.assertConsistency?.price?.(a);
            expect(a.active).toBe(true);
            expectImmutablesUnchanged(a, snapshot);
          },
        );
      },
    );

    // -------------------------------------------------------------------------
    // Scenario 2: deactivate + activate (one-time)
    // -------------------------------------------------------------------------
    lazySkipIf(() => !harness?.fixtures?.oneTimePriceId)(
      'scenario 2: deactivate + activate (one-time)',
      async () => {
        const id = requireFixture(harness.fixtures?.oneTimePriceId, 'oneTimePriceId');
        await runPriceScenario(
          provider,
          harness,
          id,
          'one_time',
          async ({ snapshot, originalMetadata, originalQuantity }) => {
            const deactivated = await provider.prices.deactivate({ id });
            expect(deactivated).not.toBeNull();
            const d = deactivated as ProviderPrice;
            await harness.assertConsistency?.price?.(d);
            expect(d.id).toBe(id);
            expect(d.active).toBe(false);
            expectImmutablesUnchanged(d, snapshot);
            expectDeepEqual(d.metadata, originalMetadata);
            expectDeepEqual(d.quantity, originalQuantity);

            const refetched = await provider.prices.get({ id });
            expect(refetched).not.toBeNull();
            expect((refetched as ProviderPrice).active).toBe(false);

            const reactivated = await provider.prices.activate({ id });
            expect(reactivated).not.toBeNull();
            const a = reactivated as ProviderPrice;
            await harness.assertConsistency?.price?.(a);
            expect(a.active).toBe(true);
            expectImmutablesUnchanged(a, snapshot);
          },
        );
      },
    );

    // -------------------------------------------------------------------------
    // Scenario 3: replace metadata + revert (recurring)
    // -------------------------------------------------------------------------
    lazySkipIf(() => !harness?.fixtures?.recurringPriceId)(
      'scenario 3: replace metadata + revert (recurring)',
      async () => {
        const id = requireFixture(harness.fixtures?.recurringPriceId, 'recurringPriceId');
        await runPriceScenario(
          provider,
          harness,
          id,
          'recurring',
          async ({ snapshot, originalQuantity }) => {
            const probeMetadata: Metadata = {
              conformance_probe_prices_fixture: 'scenario_3_recurring',
            };
            const updated = await provider.prices.update({ id, metadata: probeMetadata });
            expect(updated).not.toBeNull();
            const u = updated as ProviderPrice;
            await harness.assertConsistency?.price?.(u);
            expectDeepEqual(u.metadata, probeMetadata);
            expectNoProviderKeys(u.metadata);
            expect(u.active).toBe(true);
            expectImmutablesUnchanged(u, snapshot);
            expectDeepEqual(u.quantity, originalQuantity);

            const refetched = await provider.prices.get({ id });
            expect(refetched).not.toBeNull();
            expectDeepEqual((refetched as ProviderPrice).metadata, probeMetadata);
          },
        );
      },
    );

    // -------------------------------------------------------------------------
    // Scenario 4: replace metadata + revert (one-time)
    // -------------------------------------------------------------------------
    lazySkipIf(() => !harness?.fixtures?.oneTimePriceId)(
      'scenario 4: replace metadata + revert (one-time)',
      async () => {
        const id = requireFixture(harness.fixtures?.oneTimePriceId, 'oneTimePriceId');
        await runPriceScenario(
          provider,
          harness,
          id,
          'one_time',
          async ({ snapshot, originalQuantity }) => {
            const probeMetadata: Metadata = {
              conformance_probe_prices_fixture: 'scenario_4_one_time',
            };
            const updated = await provider.prices.update({ id, metadata: probeMetadata });
            expect(updated).not.toBeNull();
            const u = updated as ProviderPrice;
            await harness.assertConsistency?.price?.(u);
            expectDeepEqual(u.metadata, probeMetadata);
            expectNoProviderKeys(u.metadata);
            expect(u.active).toBe(true);
            expectImmutablesUnchanged(u, snapshot);
            expectDeepEqual(u.quantity, originalQuantity);

            const refetched = await provider.prices.get({ id });
            expect(refetched).not.toBeNull();
            expectDeepEqual((refetched as ProviderPrice).metadata, probeMetadata);
          },
        );
      },
    );

    // -------------------------------------------------------------------------
    // Scenario 5: update quantity + revert (recurring)
    // -------------------------------------------------------------------------
    lazySkipIf(() => !harness?.fixtures?.recurringPriceId)(
      'scenario 5: update quantity + revert (recurring)',
      async () => {
        const id = requireFixture(harness.fixtures?.recurringPriceId, 'recurringPriceId');
        await runPriceScenario(
          provider,
          harness,
          id,
          'recurring',
          async ({ snapshot, originalMetadata, originalQuantity }) => {
            const probeQuantity: Quantity = deepEqual(originalQuantity, { min: 1, max: 5 })
              ? { min: 1, max: 6 }
              : { min: 1, max: 5 };

            const updated = await provider.prices.update({ id, quantity: probeQuantity });
            expect(updated).not.toBeNull();
            const u = updated as ProviderPrice;
            await harness.assertConsistency?.price?.(u);
            expectDeepEqual(u.quantity, probeQuantity);
            expectDeepEqual(u.metadata, originalMetadata);
            expectNoProviderKeys(u.metadata);
            expect(u.active).toBe(true);
            expectImmutablesUnchanged(u, snapshot);

            const refetched = await provider.prices.get({ id });
            expect(refetched).not.toBeNull();
            expectDeepEqual((refetched as ProviderPrice).quantity, probeQuantity);
          },
        );
      },
    );

    // -------------------------------------------------------------------------
    // Scenario 6: update quantity + revert (one-time)
    // -------------------------------------------------------------------------
    lazySkipIf(() => !harness?.fixtures?.oneTimePriceId)(
      'scenario 6: update quantity + revert (one-time)',
      async () => {
        const id = requireFixture(harness.fixtures?.oneTimePriceId, 'oneTimePriceId');
        await runPriceScenario(
          provider,
          harness,
          id,
          'one_time',
          async ({ snapshot, originalMetadata, originalQuantity }) => {
            const probeQuantity: Quantity = deepEqual(originalQuantity, { min: 2, max: 10 })
              ? { min: 3, max: 10 }
              : { min: 2, max: 10 };

            const updated = await provider.prices.update({ id, quantity: probeQuantity });
            expect(updated).not.toBeNull();
            const u = updated as ProviderPrice;
            await harness.assertConsistency?.price?.(u);
            expectDeepEqual(u.quantity, probeQuantity);
            expectDeepEqual(u.metadata, originalMetadata);
            expectNoProviderKeys(u.metadata);
            expect(u.active).toBe(true);
            expectImmutablesUnchanged(u, snapshot);

            const refetched = await provider.prices.get({ id });
            expect(refetched).not.toBeNull();
            expectDeepEqual((refetched as ProviderPrice).quantity, probeQuantity);
          },
        );
      },
    );

    // -------------------------------------------------------------------------
    // Scenario 7: combined metadata + quantity update + revert (recurring)
    // -------------------------------------------------------------------------
    lazySkipIf(() => !harness?.fixtures?.recurringPriceId)(
      'scenario 7: combined metadata + quantity update + revert (recurring)',
      async () => {
        const id = requireFixture(harness.fixtures?.recurringPriceId, 'recurringPriceId');
        await runPriceScenario(
          provider,
          harness,
          id,
          'recurring',
          async ({ snapshot, originalQuantity }) => {
            const probeMetadata: Metadata = {
              conformance_probe_prices_fixture: 'scenario_7_recurring',
            };
            const probeQuantity: Quantity = deepEqual(originalQuantity, { min: 1, max: 5 })
              ? { min: 1, max: 6 }
              : { min: 1, max: 5 };

            const updated = await provider.prices.update({
              id,
              metadata: probeMetadata,
              quantity: probeQuantity,
            });
            expect(updated).not.toBeNull();
            const u = updated as ProviderPrice;
            await harness.assertConsistency?.price?.(u);
            expectDeepEqual(u.metadata, probeMetadata);
            expectNoProviderKeys(u.metadata);
            expectDeepEqual(u.quantity, probeQuantity);
            expect(u.active).toBe(true);
            expectImmutablesUnchanged(u, snapshot);

            const refetched = await provider.prices.get({ id });
            expect(refetched).not.toBeNull();
            const f = refetched as ProviderPrice;
            expectDeepEqual(f.metadata, probeMetadata);
            expectDeepEqual(f.quantity, probeQuantity);
          },
        );
      },
    );

    // -------------------------------------------------------------------------
    // Scenario 8: combined metadata + quantity update + revert (one-time)
    // -------------------------------------------------------------------------
    lazySkipIf(() => !harness?.fixtures?.oneTimePriceId)(
      'scenario 8: combined metadata + quantity update + revert (one-time)',
      async () => {
        const id = requireFixture(harness.fixtures?.oneTimePriceId, 'oneTimePriceId');
        await runPriceScenario(
          provider,
          harness,
          id,
          'one_time',
          async ({ snapshot, originalQuantity }) => {
            const probeMetadata: Metadata = {
              conformance_probe_prices_fixture: 'scenario_8_one_time',
            };
            const probeQuantity: Quantity = deepEqual(originalQuantity, { min: 2, max: 10 })
              ? { min: 3, max: 10 }
              : { min: 2, max: 10 };

            const updated = await provider.prices.update({
              id,
              metadata: probeMetadata,
              quantity: probeQuantity,
            });
            expect(updated).not.toBeNull();
            const u = updated as ProviderPrice;
            await harness.assertConsistency?.price?.(u);
            expectDeepEqual(u.metadata, probeMetadata);
            expectNoProviderKeys(u.metadata);
            expectDeepEqual(u.quantity, probeQuantity);
            expect(u.active).toBe(true);
            expectImmutablesUnchanged(u, snapshot);

            const refetched = await provider.prices.get({ id });
            expect(refetched).not.toBeNull();
            const f = refetched as ProviderPrice;
            expectDeepEqual(f.metadata, probeMetadata);
            expectDeepEqual(f.quantity, probeQuantity);
          },
        );
      },
    );
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
