import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { BillingProvider, ProviderDiscount } from '../../../index.js';
import type { Metadata } from '../../../models/metadata.js';
import { withFixture } from '../../fixture-runner.js';
import type { ProviderTestHarness } from '../../harness.js';
import { lazySkipIf, requireFixture } from '../../skip-if.js';

/**
 * Registers the discounts fixture-tier conformance suite. Each scenario
 * exercises the pre-provisioned discount at `harness.fixtures.discountId`
 * through a reversible operation, asserting normalized output, then reverts
 * to the original state captured in `healthCheck`.
 *
 * The clean starting state is: `active === true`, `expiresAt === null`.
 * The mutable surface covered here is `{expiresAt, metadata}` via `update`,
 * plus the `deactivate` / `activate` state toggles. Immutable fields
 * (`benefit`, `duration`, `code`, `redemptionLimit`) are intentionally not
 * touched — they are not present in the update schema.
 *
 * Tests gate via `lazySkipIf(() => !harness?.fixtures?.discountId)`; harnesses that
 * do not supply a discount fixture simply skip every scenario.
 */
/**
 * A future Date the test can use as a discount expiration. Computed at test
 * time so it stays within whatever future-window the live provider enforces
 * — Stripe rejects `expires_at` more than five years out. Four years is a
 * comfortable margin while still being well past any test run.
 *
 * Floored to whole seconds so providers that store expirations in unix
 * seconds (Stripe) round-trip the value with exact `getTime()` equality.
 */
function futureExpiration(): Date {
  const fourYearsMs = 4 * 365 * 24 * 60 * 60 * 1000;
  return new Date(Math.floor((Date.now() + fourYearsMs) / 1000) * 1000);
}

export function registerDiscountsFixtureSuite(
  label: string,
  factory: () => ProviderTestHarness | Promise<ProviderTestHarness>,
): void {
  describe(`discounts [${label}]`, () => {
    let harness!: ProviderTestHarness;
    let provider!: BillingProvider;

    beforeAll(async () => {
      harness = await Promise.resolve(factory());
      provider = harness.provider;
    });

    // -------------------------------------------------------------------------
    // Scenario 1: deactivate + activate
    // -------------------------------------------------------------------------
    lazySkipIf(() => !harness?.fixtures?.discountId)(
      'deactivate then activate restores clean state',
      async () => {
        const id = requireFixture(harness.fixtures?.discountId, 'discountId');
        let originalMetadata: Metadata = {};
        let originalExpiresAt: Date | null = null;

        await withFixture(`discount:${id}`, {
          healthCheck: async () => {
            const original = await provider.discounts.get({ id });
            if (original === null) {
              throw new Error(`discount ${id} not found`);
            }
            if (original.active !== true) {
              throw new Error(`discount ${id} has active=${original.active}; expected true`);
            }
            if (original.expiresAt !== null) {
              throw new Error(
                `discount ${id} has expiresAt=${String(original.expiresAt)}; expected null`,
              );
            }
            originalMetadata = original.metadata;
            originalExpiresAt = original.expiresAt;
          },
          test: async () => {
            const deactivated = await provider.discounts.deactivate({ id });
            if (deactivated === null) {
              throw new Error(`deactivate({id:${id}}) returned null`);
            }
            const d: ProviderDiscount = deactivated;
            await harness.assertConsistency?.discount?.(d);

            expect(d.id).toBe(id);
            expect(d.active).toBe(false);
          },
          revert: async () => {
            const reactivated = await provider.discounts.activate({ id });
            if (reactivated === null) {
              throw new Error(`activate({id:${id}}) returned null`);
            }
            const d: ProviderDiscount = reactivated;
            await harness.assertConsistency?.discount?.(d);

            if (d.active !== true) {
              throw new Error(`discount ${id} active=${d.active} after revert; expected true`);
            }
            // Sanity: starting-state invariants we captured are preserved.
            expect(d.expiresAt).toBe(originalExpiresAt);
            expect(d.metadata).toEqual(originalMetadata);
          },
        });
      },
    );

    // -------------------------------------------------------------------------
    // Scenario 2: expiresAt is immutable — pass-through-strip is the contract
    // -------------------------------------------------------------------------
    //
    // `expiresAt` is create-only across providers; calling `update` with the
    // field set must leave the discount's actual expiration unchanged. The
    // automated suite covers the "Zod strips it" semantic; this fixture-level
    // scenario verifies the live-provider behavior matches.
    lazySkipIf(() => !harness?.fixtures?.discountId)(
      'update silently leaves expiresAt unchanged (immutable post-create)',
      async () => {
        const id = requireFixture(harness.fixtures?.discountId, 'discountId');
        let originalExpiresAt: Date | null = null;

        await withFixture(`discount:${id}`, {
          healthCheck: async () => {
            const original = await provider.discounts.get({ id });
            if (original === null) {
              throw new Error(`discount ${id} not found`);
            }
            if (original.active !== true) {
              throw new Error(`discount ${id} has active=${original.active}; expected true`);
            }
            originalExpiresAt = original.expiresAt;
          },
          test: async () => {
            // Cast through `any` to bypass the input type (which doesn't
            // include `expiresAt`). The runtime should strip it.
            const updated = await provider.discounts.update({
              id,
              expiresAt: futureExpiration(),
            } as any);
            await harness.assertConsistency?.discount?.(updated);
            expect(updated.id).toBe(id);
            // Expiration unchanged from the pre-update state.
            const a = originalExpiresAt;
            const b = updated.expiresAt;
            const same = a === null ? b === null : b !== null && a.getTime() === b.getTime();
            if (!same) {
              throw new Error(
                `discount ${id} expiresAt changed: before=${String(a)} after=${String(b)}`,
              );
            }
          },
          revert: async () => {
            // No-op: the test didn't mutate the resource.
          },
        });
      },
    );

    // -------------------------------------------------------------------------
    // Scenario 3: replace metadata + revert
    // -------------------------------------------------------------------------
    lazySkipIf(() => !harness?.fixtures?.discountId)(
      'update({metadata}) REPLACES metadata and revert restores original',
      async () => {
        const id = requireFixture(harness.fixtures?.discountId, 'discountId');
        let originalMetadata: Metadata = {};
        let originalExpiresAt: Date | null = null;

        await withFixture(`discount:${id}`, {
          healthCheck: async () => {
            const original = await provider.discounts.get({ id });
            if (original === null) {
              throw new Error(`discount ${id} not found`);
            }
            if (original.active !== true) {
              throw new Error(`discount ${id} has active=${original.active}; expected true`);
            }
            if (original.expiresAt !== null) {
              throw new Error(
                `discount ${id} has expiresAt=${String(original.expiresAt)}; expected null`,
              );
            }
            originalMetadata = original.metadata;
            originalExpiresAt = original.expiresAt;
          },
          test: async () => {
            const newMetadata: Metadata = { test_run: 'fixture' };
            const updated = await provider.discounts.update({
              id,
              metadata: newMetadata,
            });
            await harness.assertConsistency?.discount?.(updated);

            expect(updated.id).toBe(id);
            expect(updated.metadata.test_run).toBe('fixture');
            for (const key of Object.keys(updated.metadata)) {
              expect(key.startsWith('__provider_')).toBe(false);
            }
            expect(updated.active).toBe(true);
            expect(updated.expiresAt).toBeNull();
          },
          revert: async () => {
            const reverted = await provider.discounts.update({
              id,
              metadata: originalMetadata,
            });
            await harness.assertConsistency?.discount?.(reverted);

            // Deep-equal check; throw an informative error if it diverges so
            // the runner marks the fixture dirty.
            const got = JSON.stringify(reverted.metadata);
            const want = JSON.stringify(originalMetadata);
            if (got !== want) {
              throw new Error(`discount ${id} metadata=${got} after revert; expected ${want}`);
            }
            expect(reverted.metadata).toEqual(originalMetadata);
            expect(reverted.expiresAt).toBe(originalExpiresAt);
          },
        });
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
