import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ProviderConstraintError } from '../../../errors/index.js';
import type { ProviderSubscription, SubscriptionItem } from '../../../index.js';
import { withFixture } from '../../fixture-runner.js';
import type { ProviderTestHarness } from '../../harness.js';
import { lazySkipIf, nonNull, requireFixture } from '../../skip-if.js';

/**
 * Registers the subscriptions fixture-tier conformance suite. Each test
 * targets a pre-provisioned subscription whose ID lives on
 * `harness.fixtures.subscriptionId`. Tests assert the fixture is in the
 * expected clean starting state, exercise a reversible operation, then
 * restore the clean state.
 *
 * The clean starting state is: `status in {active, trialing}`,
 * `cancelAtPeriodEnd === false`, `pendingChange === null`,
 * `items.length >= 1`.
 */
export function registerSubscriptionsFixtureSuite(
  label: string,
  factory: () => ProviderTestHarness | Promise<ProviderTestHarness>,
): void {
  describe(`subscriptions [${label}]`, () => {
    let harness!: ProviderTestHarness;
    // The swap-target product+price in Scenario 2 is created at test time
    // (every provider can create products/prices via the SDK — only the
    // subscription itself can't be bootstrapped). Track BOTH so afterAll can
    // archive them: on Stripe a price stays active independently of its
    // product's active flag, so deactivating the product alone would leave an
    // active price behind every run.
    const createdProductIds = new Set<string>();
    const createdPriceIds = new Set<string>();

    beforeAll(async () => {
      harness = await Promise.resolve(factory());
    });

    // -------------------------------------------------------------------------
    // Scenario 1: cancel at_period_end + cancelScheduledChange
    // -------------------------------------------------------------------------
    lazySkipIf(() => !harness?.fixtures?.subscriptionId)(
      "cancel({when:'at_period_end'}) then cancelScheduledChange restores clean state",
      async () => {
        const id = requireFixture(harness.fixtures?.subscriptionId, 'subscriptionId');
        let snapshot: ProviderSubscription | null = null;

        await withFixture(`subscription:${id}`, {
          healthCheck: async () => {
            const sub = await harness.provider.subscriptions.get({ id });
            if (!sub) throw new Error(`subscription ${id} not found`);
            if (sub.status !== 'active' && sub.status !== 'trialing') {
              throw new Error(
                `subscription ${id} status is "${sub.status}"; expected active|trialing`,
              );
            }
            if (sub.cancelAtPeriodEnd !== false) {
              throw new Error(`subscription ${id} has cancelAtPeriodEnd=true; expected false`);
            }
            if (sub.pendingChange !== null) {
              throw new Error(`subscription ${id} has a pendingChange; expected null`);
            }
            if (sub.items.length < 1) {
              throw new Error(`subscription ${id} has no items`);
            }
            snapshot = sub;
          },
          test: async () => {
            const cancelled = await harness.provider.subscriptions.cancel({
              id,
              when: 'at_period_end',
            });
            await harness.assertConsistency?.subscription?.(cancelled);

            expect(cancelled.id).toBe(id);
            expect(cancelled.cancelAtPeriodEnd).toBe(true);
            expect(['active', 'trialing']).toContain(cancelled.status);
            expect(cancelled.canceledAt).toBeNull();
            expect(
              cancelled.pendingChange === null || cancelled.pendingChange.kind === 'cancel',
            ).toBe(true);
            // Items unchanged from snapshot.
            const before = nonNull(snapshot, 'snapshot');
            expect(cancelled.items.map((i) => i.priceId)).toEqual(
              before.items.map((i) => i.priceId),
            );
            expect(cancelled.items.map((i) => i.quantity)).toEqual(
              before.items.map((i) => i.quantity),
            );
          },
          revert: async () => {
            const reverted = await harness.provider.subscriptions.cancelScheduledChange({
              id,
            });
            await harness.assertConsistency?.subscription?.(reverted);
            expect(reverted.cancelAtPeriodEnd).toBe(false);
            expect(reverted.pendingChange).toBeNull();

            // Universal revert verification — fresh get, assert clean state.
            const fresh = await harness.provider.subscriptions.get({ id });
            expect(fresh).not.toBeNull();
            const f = fresh as ProviderSubscription;
            expect(['active', 'trialing']).toContain(f.status);
            expect(f.cancelAtPeriodEnd).toBe(false);
            expect(f.pendingChange).toBeNull();
            expect(f.items.length).toBeGreaterThanOrEqual(1);
          },
        });
      },
    );

    // -------------------------------------------------------------------------
    // Scenario 2: change at_period_end to different price + cancelScheduledChange
    // -------------------------------------------------------------------------
    // Also skipped when the provider can't defer item changes (Paddle,
    // `deferredSubscriptionChange: false`) — there `change` only applies
    // immediately and the reject is covered by the automated suite.
    lazySkipIf(
      () =>
        !harness?.fixtures?.subscriptionId ||
        harness?.provider?.capabilities?.deferredSubscriptionChange === false,
    )(
      "change({when:'at_period_end', priceId}) schedules price_change and cancelScheduledChange restores it",
      async () => {
        const id = requireFixture(harness.fixtures?.subscriptionId, 'subscriptionId');

        // The swap target is created at test time — every provider can
        // create products/prices via the SDK, so there's no need to
        // pre-provision a second price. Mirror the subscription's current
        // price (currency/interval) at a different amount so the change is
        // accepted and is guaranteed to differ from the current price.
        const pre = await harness.provider.subscriptions.get({ id });
        if (!pre) {
          throw new Error(`subscription ${id} not found`);
        }
        const currentPriceId = nonNull(pre.items[0], 'subscription.items[0]').priceId;
        const currentPrice = await harness.provider.prices.get({ id: currentPriceId });
        if (!currentPrice) {
          throw new Error(`subscription ${id} current price ${currentPriceId} not found`);
        }
        const swapProduct = await harness.provider.products.create({
          name: 'fixture-swap-target',
          taxCategory: 'saas',
        });
        createdProductIds.add(swapProduct.id);
        const swapPrice = await harness.provider.prices.create({
          productId: swapProduct.id,
          currency: currentPrice.currency,
          kind: 'recurring',
          unitAmount: currentPrice.unitAmount + 500,
          interval: currentPrice.kind === 'recurring' ? currentPrice.interval : 'month',
          intervalCount: currentPrice.kind === 'recurring' ? currentPrice.intervalCount : 1,
        } as any);
        createdPriceIds.add(swapPrice.id);
        const recurringPriceId = swapPrice.id;

        let snapshot: ProviderSubscription | null = null;

        await withFixture(`subscription:${id}`, {
          healthCheck: async () => {
            const sub = await harness.provider.subscriptions.get({ id });
            if (!sub) throw new Error(`subscription ${id} not found`);
            if (sub.status !== 'active' && sub.status !== 'trialing') {
              throw new Error(
                `subscription ${id} status is "${sub.status}"; expected active|trialing`,
              );
            }
            if (sub.cancelAtPeriodEnd !== false) {
              throw new Error(`subscription ${id} has cancelAtPeriodEnd=true; expected false`);
            }
            if (sub.pendingChange !== null) {
              throw new Error(`subscription ${id} has a pendingChange; expected null`);
            }
            if (sub.items.length !== 1) {
              throw new Error(
                `subscription ${id} has ${sub.items.length} items; price-change scenario requires exactly 1. Replace the fixture with a single-item subscription.`,
              );
            }
            snapshot = sub;
          },
          test: async () => {
            const oldPriceId = nonNull(
              nonNull(snapshot, 'snapshot').items[0],
              'snapshot.items[0]',
            ).priceId;
            const changed = await harness.provider.subscriptions.change({
              id,
              when: 'at_period_end',
              items: [{ priceId: recurringPriceId }],
            } as any);
            await harness.assertConsistency?.subscription?.(changed);

            expect(changed.id).toBe(id);
            expect(['active', 'trialing']).toContain(changed.status);
            expect(changed.cancelAtPeriodEnd).toBe(false);
            // Current items unchanged — the schedule lives in pendingChange.
            expect(changed.items[0]?.priceId).toBe(oldPriceId);
            expect(changed.pendingChange).not.toBeNull();
            expect(changed.pendingChange?.kind).toBe('price_change');
            expect(changed.pendingChange?.items?.[0]?.priceId).toBe(recurringPriceId);
            expect(changed.pendingChange?.effectiveAt).toBeInstanceOf(Date);
          },
          revert: async () => {
            const oldPriceId = nonNull(
              nonNull(snapshot, 'snapshot').items[0],
              'snapshot.items[0]',
            ).priceId;
            const reverted = await harness.provider.subscriptions.cancelScheduledChange({
              id,
            });
            await harness.assertConsistency?.subscription?.(reverted);
            expect(reverted.pendingChange).toBeNull();
            expect(reverted.items[0]?.priceId).toBe(oldPriceId);

            // Universal revert verification — fresh get, assert clean state.
            const fresh = await harness.provider.subscriptions.get({ id });
            expect(fresh).not.toBeNull();
            const f = fresh as ProviderSubscription;
            expect(['active', 'trialing']).toContain(f.status);
            expect(f.cancelAtPeriodEnd).toBe(false);
            expect(f.pendingChange).toBeNull();
            expect(f.items.length).toBeGreaterThanOrEqual(1);
          },
        });
      },
    );

    // -------------------------------------------------------------------------
    // Scenario 3: change at_period_end quantity + cancelScheduledChange
    // -------------------------------------------------------------------------
    // Also skipped when the provider can't defer item changes (Paddle).
    lazySkipIf(
      () =>
        !harness?.fixtures?.subscriptionId ||
        harness?.provider?.capabilities?.deferredSubscriptionChange === false,
    )(
      "change({when:'at_period_end', quantity}) schedules price_change and cancelScheduledChange restores it",
      async () => {
        const id = requireFixture(harness.fixtures?.subscriptionId, 'subscriptionId');
        let snapshot: ProviderSubscription | null = null;
        let snapshotItem: SubscriptionItem | null = null;
        let scheduled = false;

        await withFixture(`subscription:${id}`, {
          healthCheck: async () => {
            const sub = await harness.provider.subscriptions.get({ id });
            if (!sub) throw new Error(`subscription ${id} not found`);
            if (sub.status !== 'active' && sub.status !== 'trialing') {
              throw new Error(
                `subscription ${id} status is "${sub.status}"; expected active|trialing`,
              );
            }
            if (sub.cancelAtPeriodEnd !== false) {
              throw new Error(`subscription ${id} has cancelAtPeriodEnd=true; expected false`);
            }
            if (sub.pendingChange !== null) {
              throw new Error(`subscription ${id} has a pendingChange; expected null`);
            }
            if (sub.items.length !== 1) {
              throw new Error(
                `subscription ${id} has ${sub.items.length} items; quantity-change scenario requires exactly 1. Replace the fixture with a single-item subscription.`,
              );
            }
            snapshot = sub;
            snapshotItem = nonNull(sub.items[0], 'sub.items[0]');
          },
          test: async () => {
            const { priceId, quantity: oldQty } = nonNull(snapshotItem, 'snapshotItem');
            const targetQty = oldQty > 1 ? oldQty - 1 : oldQty + 1;

            try {
              const changed = await harness.provider.subscriptions.change({
                id,
                when: 'at_period_end',
                items: [{ priceId, quantity: targetQty }],
              } as any);
              scheduled = true;
              await harness.assertConsistency?.subscription?.(changed);

              expect(changed.cancelAtPeriodEnd).toBe(false);
              // Current items unchanged.
              expect(changed.items[0]?.priceId).toBe(priceId);
              expect(changed.items[0]?.quantity).toBe(oldQty);
              expect(changed.pendingChange).not.toBeNull();
              expect(changed.pendingChange?.kind).toBe('price_change');
              expect(changed.pendingChange?.items?.[0]?.priceId).toBe(priceId);
              expect(changed.pendingChange?.items?.[0]?.quantity).toBe(targetQty);
              expect(changed.pendingChange?.effectiveAt).toBeInstanceOf(Date);
            } catch (err) {
              if (err instanceof ProviderConstraintError) {
                // Constraint skip — typically the price has {min:1, max:1}
                // quantity bounds. Leave `scheduled = false` so revert is a no-op
                // (still runs universal verification).
                return;
              }
              throw err;
            }
          },
          revert: async () => {
            if (scheduled) {
              const reverted = await harness.provider.subscriptions.cancelScheduledChange({
                id,
              });
              await harness.assertConsistency?.subscription?.(reverted);
              expect(reverted.pendingChange).toBeNull();
              expect(reverted.items[0]?.quantity).toBe(
                nonNull(snapshotItem, 'snapshotItem').quantity,
              );
            }

            // Universal revert verification — fresh get, assert clean state.
            const fresh = await harness.provider.subscriptions.get({ id });
            expect(fresh).not.toBeNull();
            const f = fresh as ProviderSubscription;
            expect(['active', 'trialing']).toContain(f.status);
            expect(f.cancelAtPeriodEnd).toBe(false);
            expect(f.pendingChange).toBeNull();
            expect(f.items.length).toBeGreaterThanOrEqual(1);
          },
        });
      },
    );

    // Archive the swap-target product+price created at test time. Prices
    // first: on Stripe a price can't be deleted and stays active regardless
    // of its product's active flag, so it must be explicitly deactivated or
    // it lingers active every run. Then the product (hard-delete via the
    // harness hook when possible — Stripe drops price-free products — else
    // soft-delete). The pre-provisioned subscription is intentionally left
    // untouched (no teardown).
    afterAll(async () => {
      for (const priceId of createdPriceIds) {
        try {
          await harness?.cleanupResource?.('price', priceId);
        } catch {
          // Ignore hard-delete failures — soft-delete below is the fallback.
        }
        try {
          await harness.provider.prices.deactivate({ id: priceId });
        } catch {
          // Ignore cleanup failures.
        }
      }
      for (const productId of createdProductIds) {
        try {
          await harness?.cleanupResource?.('product', productId);
        } catch {
          // Ignore hard-delete failures — soft-delete below is the fallback.
        }
        try {
          await harness.provider.products.deactivate({ id: productId });
        } catch {
          // Ignore cleanup failures.
        }
      }
    });
  });
}
