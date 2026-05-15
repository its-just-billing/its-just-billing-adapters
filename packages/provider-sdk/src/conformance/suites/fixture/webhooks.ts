import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ProviderEventType, ProviderWebhookEndpoint } from '../../../index.js';
import { withFixture } from '../../fixture-runner.js';
import type { ProviderTestHarness } from '../../harness.js';
import { lazySkipIf, requireFixture } from '../../skip-if.js';

/**
 * Registers the webhooks fixture-tier conformance suite. Each scenario targets
 * the pre-provisioned webhook endpoint at `harness.fixtures.webhookEndpointId`,
 * asserts it is in the expected clean starting state (active, with a stable
 * `eventTypes` array we record and restore), exercises a reversible operation,
 * then restores the snapshot.
 *
 * The clean starting state is: `active === true`. Tests record `url` and
 * `eventTypes` from the healthCheck and restore them in `revert`.
 *
 * Tests are gated via `lazySkipIf(() => !harness?.fixtures?.webhookEndpointId)`;
 * harnesses that do not supply a webhook endpoint fixture skip every scenario.
 *
 * No `getEndpoint` method exists on the Webhooks domain — every read uses
 * `listEndpoints()` and filters by id.
 */
export function registerWebhooksFixtureSuite(
  label: string,
  factory: () => ProviderTestHarness | Promise<ProviderTestHarness>,
): void {
  /**
   * Order-insensitive deep equality for a string array. Mutates copies, not
   * the inputs.
   */
  function arraysEqualSortInsensitive(a: readonly string[], b: readonly string[]): boolean {
    if (a.length !== b.length) return false;
    const aSorted = [...a].sort();
    const bSorted = [...b].sort();
    for (let i = 0; i < aSorted.length; i++) {
      if (aSorted[i] !== bSorted[i]) return false;
    }
    return true;
  }

  /**
   * Look the fixture endpoint up via listEndpoints + filter by id. Throws with
   * a descriptive message if the endpoint is not present.
   */
  async function findEndpointById(
    harness: ProviderTestHarness,
    id: string,
  ): Promise<ProviderWebhookEndpoint> {
    const page = await harness.provider.webhooks.listEndpoints();
    const found = page.data.find((e) => e.id === id);
    if (!found) {
      throw new Error(`webhook endpoint ${id} not found in listEndpoints() result`);
    }
    return found;
  }

  describe(`webhooks [${label}]`, () => {
    let harness!: ProviderTestHarness;

    beforeAll(async () => {
      harness = await Promise.resolve(factory());
    });

    // -------------------------------------------------------------------------
    // Scenario 1: deactivateEndpoint + activateEndpoint
    // -------------------------------------------------------------------------
    lazySkipIf(() => !harness?.fixtures?.webhookEndpointId)(
      'deactivateEndpoint flips active=false, activateEndpoint restores active=true',
      async () => {
        const id = requireFixture(harness.fixtures?.webhookEndpointId, 'webhookEndpointId');
        let originalUrl = '';
        let originalEventTypes: readonly ProviderEventType[] = [];

        await withFixture(`webhookEndpoint:${id}`, {
          healthCheck: async () => {
            const endpoint = await findEndpointById(harness, id);
            if (endpoint.active !== true) {
              throw new Error(
                `webhook endpoint ${id} has active=${endpoint.active}; expected true`,
              );
            }
            originalUrl = endpoint.url;
            originalEventTypes = [...endpoint.eventTypes];
          },
          test: async () => {
            const deactivated = await harness.provider.webhooks.deactivateEndpoint({
              id,
            });
            expect(deactivated).not.toBeNull();
            const d = deactivated as ProviderWebhookEndpoint;
            await harness.assertConsistency?.webhookEndpoint?.(d);

            expect(d.id).toBe(id);
            expect(d.active).toBe(false);
            expect(d.url).toBe(originalUrl);
            expect(arraysEqualSortInsensitive(d.eventTypes, originalEventTypes)).toBe(true);

            // Refetch via listEndpoints — read-only, no consistency hook.
            const refetched = await findEndpointById(harness, id);
            expect(refetched.active).toBe(false);

            const reactivated = await harness.provider.webhooks.activateEndpoint({
              id,
            });
            expect(reactivated).not.toBeNull();
            const r = reactivated as ProviderWebhookEndpoint;
            await harness.assertConsistency?.webhookEndpoint?.(r);

            expect(r.id).toBe(id);
            expect(r.active).toBe(true);
            expect(r.url).toBe(originalUrl);
            expect(arraysEqualSortInsensitive(r.eventTypes, originalEventTypes)).toBe(true);
          },
          revert: async () => {
            const endpoint = await findEndpointById(harness, id);

            if (!endpoint.active) {
              const result = await harness.provider.webhooks.activateEndpoint({ id });
              expect(result).not.toBeNull();
              const a = result as ProviderWebhookEndpoint;
              await harness.assertConsistency?.webhookEndpoint?.(a);
              expect(a.active).toBe(true);
            }

            // Defensive: if test left url or eventTypes drifted, restore them.
            const driftedUrl = endpoint.url !== originalUrl;
            const driftedTypes = !arraysEqualSortInsensitive(
              endpoint.eventTypes,
              originalEventTypes,
            );
            if (driftedUrl || driftedTypes) {
              const restored = await harness.provider.webhooks.updateEndpoint({
                id,
                url: originalUrl,
                eventTypes: [...originalEventTypes],
              });
              await harness.assertConsistency?.webhookEndpoint?.(restored);
              expect(restored.url).toBe(originalUrl);
              expect(arraysEqualSortInsensitive(restored.eventTypes, originalEventTypes)).toBe(
                true,
              );
            }
          },
        });
      },
    );

    // -------------------------------------------------------------------------
    // Scenario 2: updateEndpoint url + revert
    // -------------------------------------------------------------------------
    lazySkipIf(() => !harness?.fixtures?.webhookEndpointId)(
      'updateEndpoint changes url; revert restores it',
      async () => {
        const id = requireFixture(harness.fixtures?.webhookEndpointId, 'webhookEndpointId');
        let originalUrl = '';
        let originalEventTypes: readonly ProviderEventType[] = [];

        await withFixture(`webhookEndpoint:${id}`, {
          healthCheck: async () => {
            const endpoint = await findEndpointById(harness, id);
            if (endpoint.active !== true) {
              throw new Error(
                `webhook endpoint ${id} has active=${endpoint.active}; expected true`,
              );
            }
            originalUrl = endpoint.url;
            originalEventTypes = [...endpoint.eventTypes];
          },
          test: async () => {
            const nextUrl = `https://example.com/fixture-test-${Date.now()}`;
            expect(nextUrl).not.toBe(originalUrl);

            const updated = await harness.provider.webhooks.updateEndpoint({
              id,
              url: nextUrl,
            });
            await harness.assertConsistency?.webhookEndpoint?.(updated);

            expect(updated.id).toBe(id);
            expect(updated.url).toBe(nextUrl);
            expect(updated.active).toBe(true);
            expect(arraysEqualSortInsensitive(updated.eventTypes, originalEventTypes)).toBe(true);

            const refetched = await findEndpointById(harness, id);
            expect(refetched.url).toBe(nextUrl);
          },
          revert: async () => {
            const reverted = await harness.provider.webhooks.updateEndpoint({
              id,
              url: originalUrl,
            });
            await harness.assertConsistency?.webhookEndpoint?.(reverted);
            expect(reverted.url).toBe(originalUrl);
          },
        });
      },
    );

    // -------------------------------------------------------------------------
    // Scenario 3: updateEndpoint eventTypes + revert
    // -------------------------------------------------------------------------
    lazySkipIf(() => !harness?.fixtures?.webhookEndpointId)(
      'updateEndpoint changes eventTypes; revert restores them',
      async () => {
        const id = requireFixture(harness.fixtures?.webhookEndpointId, 'webhookEndpointId');
        let originalUrl = '';
        let originalEventTypes: readonly ProviderEventType[] = [];

        await withFixture(`webhookEndpoint:${id}`, {
          healthCheck: async () => {
            const endpoint = await findEndpointById(harness, id);
            if (endpoint.active !== true) {
              throw new Error(
                `webhook endpoint ${id} has active=${endpoint.active}; expected true`,
              );
            }
            if (endpoint.eventTypes.length < 1) {
              throw new Error(
                `webhook endpoint ${id} has eventTypes.length=${endpoint.eventTypes.length}; expected >= 1`,
              );
            }
            originalUrl = endpoint.url;
            originalEventTypes = [...endpoint.eventTypes];
          },
          test: async () => {
            // Choose a target that's guaranteed different from the sorted original.
            const sortedOriginal = [...originalEventTypes].sort();
            const isSingleCreated =
              sortedOriginal.length === 1 && sortedOriginal[0] === 'customer.created';
            const nextEventTypes: ProviderEventType[] = isSingleCreated
              ? ['customer.updated']
              : ['customer.created'];

            const updated = await harness.provider.webhooks.updateEndpoint({
              id,
              eventTypes: nextEventTypes,
            });
            await harness.assertConsistency?.webhookEndpoint?.(updated);

            expect(updated.id).toBe(id);
            expect(arraysEqualSortInsensitive(updated.eventTypes, nextEventTypes)).toBe(true);
            expect(updated.url).toBe(originalUrl);
            expect(updated.active).toBe(true);

            const refetched = await findEndpointById(harness, id);
            expect(arraysEqualSortInsensitive(refetched.eventTypes, nextEventTypes)).toBe(true);
          },
          revert: async () => {
            const reverted = await harness.provider.webhooks.updateEndpoint({
              id,
              eventTypes: [...originalEventTypes],
            });
            await harness.assertConsistency?.webhookEndpoint?.(reverted);
            expect(arraysEqualSortInsensitive(reverted.eventTypes, originalEventTypes)).toBe(true);
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
