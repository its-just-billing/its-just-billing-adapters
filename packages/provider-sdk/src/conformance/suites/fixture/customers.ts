import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { BillingProvider, ProviderCustomer } from '../../../index.js';
import { withFixture } from '../../fixture-runner.js';
import type { ProviderTestHarness } from '../../harness.js';
import { lazySkipIf, requireFixture } from '../../skip-if.js';

/**
 * Registers the customers fixture conformance suite. Each scenario exercises
 * the pre-provisioned customer at `harness.fixtures.customerId` through a
 * reversible write, asserting normalized output, then reverts to the snapshot
 * captured by the healthCheck.
 *
 * Tests gate via `lazySkipIf(() => !harness?.fixtures?.customerId)`; harnesses that
 * do not supply a customer fixture simply skip every scenario.
 */
export function registerCustomersFixtureSuite(
  label: string,
  factory: () => ProviderTestHarness | Promise<ProviderTestHarness>,
): void {
  function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
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
      expect(k.startsWith('__provider_')).toBe(false);
    }
    expect(rec.createdAt).toBeInstanceOf(Date);
    expect(Number.isFinite((rec.createdAt as Date).getTime())).toBe(true);
  }

  describe(`customers [${label}]`, () => {
    let harness!: ProviderTestHarness;
    let provider!: BillingProvider;

    beforeAll(async () => {
      harness = await factory();
      provider = harness.provider;
    });

    lazySkipIf(() => !harness?.fixtures?.customerId)(
      'scenario 1: update email and revert',
      async () => {
        const id = requireFixture(harness.fixtures?.customerId, 'customerId');
        let snapshot: ProviderCustomer;

        await withFixture(`customer:${id}`, {
          healthCheck: async () => {
            const got = await provider.customers.get({ id });
            if (got === null) {
              throw new Error('customer fixture not found');
            }
            snapshot = got;
          },
          test: async () => {
            const newEmail = `fixture-test-${Date.now()}@example.test`;
            const updated = await provider.customers.update({ id, email: newEmail });
            expectIsCustomer(updated);
            expect(updated.id).toBe(id);
            expect(updated.email).toBe(newEmail);
            expect(updated.name).toBe(snapshot.name);
            expect(updated.metadata).toEqual(snapshot.metadata);
            expect(updated.createdAt.getTime()).toBe(snapshot.createdAt.getTime());
            await harness.assertConsistency?.customer?.(updated);
          },
          revert: async () => {
            const restored = await provider.customers.update({ id, email: snapshot.email });
            expect(restored.email).toBe(snapshot.email);
            await harness.assertConsistency?.customer?.(restored);
          },
        });
      },
    );

    lazySkipIf(() => !harness?.fixtures?.customerId)(
      'scenario 2: update name and revert',
      async () => {
        const id = requireFixture(harness.fixtures?.customerId, 'customerId');
        let snapshot: ProviderCustomer;

        await withFixture(`customer:${id}`, {
          healthCheck: async () => {
            const got = await provider.customers.get({ id });
            if (got === null) {
              throw new Error('customer fixture not found');
            }
            snapshot = got;
          },
          test: async () => {
            const newName = `Fixture Test ${Date.now()}`;
            const updated = await provider.customers.update({ id, name: newName });
            expectIsCustomer(updated);
            expect(updated.id).toBe(id);
            expect(updated.name).toBe(newName);
            expect(updated.email).toBe(snapshot.email);
            expect(updated.metadata).toEqual(snapshot.metadata);
            expect(updated.createdAt.getTime()).toBe(snapshot.createdAt.getTime());
            await harness.assertConsistency?.customer?.(updated);
          },
          revert: async () => {
            const restored = await provider.customers.update({ id, name: snapshot.name });
            await harness.assertConsistency?.customer?.(restored);
          },
        });
      },
    );

    lazySkipIf(() => !harness?.fixtures?.customerId)(
      'scenario 3: replace metadata and revert',
      async () => {
        const id = requireFixture(harness.fixtures?.customerId, 'customerId');
        let snapshot: ProviderCustomer;

        await withFixture(`customer:${id}`, {
          healthCheck: async () => {
            const got = await provider.customers.get({ id });
            if (got === null) {
              throw new Error('customer fixture not found');
            }
            snapshot = got;
          },
          test: async () => {
            const newMeta = {
              fixture_test_run: String(Date.now()),
              fixture_label: 'conformance',
            };
            const updated = await provider.customers.update({ id, metadata: newMeta });
            expectIsCustomer(updated);
            expect(updated.metadata).toEqual(newMeta);
            for (const key of Object.keys(updated.metadata)) {
              expect(key.startsWith('__provider_')).toBe(false);
            }
            expect(updated.id).toBe(id);
            expect(updated.email).toBe(snapshot.email);
            expect(updated.name).toBe(snapshot.name);
            expect(updated.createdAt.getTime()).toBe(snapshot.createdAt.getTime());
            await harness.assertConsistency?.customer?.(updated);
          },
          revert: async () => {
            const restored = await provider.customers.update({
              id,
              metadata: snapshot.metadata,
            });
            expect(restored.metadata).toEqual(snapshot.metadata);
            await harness.assertConsistency?.customer?.(restored);
          },
        });
      },
    );

    lazySkipIf(() => !harness?.fixtures?.customerId)(
      'scenario 4: clear email (null) and revert',
      async () => {
        const id = requireFixture(harness.fixtures?.customerId, 'customerId');
        let snapshot: ProviderCustomer;
        let skipped = false;

        await withFixture(`customer:${id}`, {
          healthCheck: async () => {
            const got = await provider.customers.get({ id });
            if (got === null) {
              throw new Error('customer fixture not found');
            }
            snapshot = got;
          },
          test: async () => {
            if (snapshot.email === null) {
              skipped = true;
              return;
            }
            const updated = await provider.customers.update({ id, email: null });
            expectIsCustomer(updated);
            expect(updated.email).toBeNull();
            expect(updated.name).toBe(snapshot.name);
            expect(updated.metadata).toEqual(snapshot.metadata);
            expect(updated.id).toBe(id);
            expect(updated.createdAt.getTime()).toBe(snapshot.createdAt.getTime());
            await harness.assertConsistency?.customer?.(updated);
          },
          revert: async () => {
            if (skipped) return;
            const restored = await provider.customers.update({ id, email: snapshot.email });
            expect(restored.email).toBe(snapshot.email);
            await harness.assertConsistency?.customer?.(restored);
          },
        });
      },
    );

    lazySkipIf(() => !harness?.fixtures?.customerId)(
      'scenario 5: combined email + name update and revert',
      async () => {
        const id = requireFixture(harness.fixtures?.customerId, 'customerId');
        let snapshot: ProviderCustomer;

        await withFixture(`customer:${id}`, {
          healthCheck: async () => {
            const got = await provider.customers.get({ id });
            if (got === null) {
              throw new Error('customer fixture not found');
            }
            snapshot = got;
          },
          test: async () => {
            const stamp = Date.now();
            const newEmail = `fixture-test-${stamp}@example.test`;
            const newName = `Fixture Test ${stamp}`;
            const updated = await provider.customers.update({
              id,
              email: newEmail,
              name: newName,
            });
            expectIsCustomer(updated);
            expect(updated.email).toBe(newEmail);
            expect(updated.name).toBe(newName);
            expect(updated.metadata).toEqual(snapshot.metadata);
            expect(updated.id).toBe(id);
            expect(updated.createdAt.getTime()).toBe(snapshot.createdAt.getTime());
            await harness.assertConsistency?.customer?.(updated);
          },
          revert: async () => {
            const restored = await provider.customers.update({
              id,
              email: snapshot.email,
              name: snapshot.name,
            });
            expect(restored.email).toBe(snapshot.email);
            expect(restored.name).toBe(snapshot.name);
            await harness.assertConsistency?.customer?.(restored);
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
