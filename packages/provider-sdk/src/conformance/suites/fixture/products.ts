import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { BillingProvider } from '../../../billing-provider.js';
import type { Metadata } from '../../../models/metadata.js';
import type { ProviderProduct } from '../../../models/product.js';
import { withFixture } from '../../fixture-runner.js';
import type { ProviderTestHarness } from '../../harness.js';
import { lazySkipIf, requireFixture } from '../../skip-if.js';

/**
 * Registers the products fixture conformance suite. Each scenario operates on
 * the pre-provisioned product identified by `harness.fixtures.productId`,
 * performs a reversible mutation, and reverts.
 *
 * The brief gates every test on the presence of `harness.fixtures.productId`
 * via `it.skipIf`. Health checks capture the original state inside their
 * closure so the test and revert paths can compare against it.
 *
 * `taxCategory` is read but never mutated — it is not in the update schema.
 *
 * Every successful write (update/deactivate/activate) is followed by a
 * `harness.assertConsistency?.product?.(...)` call. Read-only `get` calls do
 * not run the consistency hook. Nullable returns are narrowed before being
 * passed to the hook.
 */
export function registerProductsFixtureSuite(
  label: string,
  factory: () => ProviderTestHarness | Promise<ProviderTestHarness>,
): void {
  describe(`products [fixture] [${label}]`, () => {
    let harness!: ProviderTestHarness;
    let provider!: BillingProvider;

    beforeAll(async () => {
      harness = await factory();
      provider = harness.provider;
    });

    // Helper: shallow clone a metadata record so callers can mutate freely
    // without affecting captured snapshots.
    function cloneMetadata(m: Metadata): Metadata {
      return { ...m };
    }

    function assertNoReservedKeys(m: Metadata): void {
      for (const k of Object.keys(m)) {
        expect(k.startsWith('__provider_')).toBe(false);
      }
    }

    // -------------------------------------------------------------------------
    // Scenario 1: deactivate + activate round-trips active state.
    // -------------------------------------------------------------------------
    lazySkipIf(() => !harness?.fixtures?.productId)(
      'deactivate + activate round-trips active state',
      async () => {
        const id = requireFixture(harness.fixtures?.productId, 'productId');
        await withFixture(`product:${id}`, {
          healthCheck: async () => {
            const current = await provider.products.get({ id });
            if (current === null) {
              throw new Error(`fixture product ${id} not found`);
            }
            if (current.active !== true) {
              throw new Error(`fixture product ${id} must start active: true`);
            }
          },
          test: async () => {
            const deactivated = await provider.products.deactivate({ id });
            expect(deactivated).not.toBeNull();
            const d = deactivated as ProviderProduct;
            expect(d.id).toBe(id);
            expect(d.active).toBe(false);
            await harness.assertConsistency?.product?.(d);

            // Re-read to confirm the deactivation is visible on read.
            const afterDeactivate = await provider.products.get({ id });
            expect(afterDeactivate).not.toBeNull();
            expect((afterDeactivate as ProviderProduct).active).toBe(false);

            const activated = await provider.products.activate({ id });
            expect(activated).not.toBeNull();
            const a = activated as ProviderProduct;
            expect(a.id).toBe(id);
            expect(a.active).toBe(true);
            await harness.assertConsistency?.product?.(a);
          },
          revert: async () => {
            const final = await provider.products.get({ id });
            if (final === null) {
              throw new Error(`fixture product ${id} disappeared during test`);
            }
            if (final.active !== true) {
              const corrective = await provider.products.activate({ id });
              if (corrective !== null) {
                await harness.assertConsistency?.product?.(corrective);
              }
              const reread = await provider.products.get({ id });
              if (reread === null || reread.active !== true) {
                throw new Error(`fixture product ${id} could not be restored to active: true`);
              }
            }
          },
        });
      },
    );

    // -------------------------------------------------------------------------
    // Scenario 2: update name + revert.
    // -------------------------------------------------------------------------
    lazySkipIf(() => !harness?.fixtures?.productId)('update name + revert', async () => {
      const id = requireFixture(harness.fixtures?.productId, 'productId');
      let originalName = '';
      let originalTaxCategory: ProviderProduct['taxCategory'] = null;
      await withFixture(`product:${id}`, {
        healthCheck: async () => {
          const current = await provider.products.get({ id });
          if (current === null) {
            throw new Error(`fixture product ${id} not found`);
          }
          if (current.active !== true) {
            throw new Error(`fixture product ${id} must start active: true`);
          }
          originalName = current.name;
          originalTaxCategory = current.taxCategory;
        },
        test: async () => {
          const newName = `${originalName} (conformance-fixture)`;
          expect(newName).not.toBe(originalName);

          const updated = await provider.products.update({ id, name: newName });
          expect(updated.id).toBe(id);
          expect(updated.name).toBe(newName);
          expect(updated.active).toBe(true);
          expect(updated.taxCategory).toBe(originalTaxCategory);
          await harness.assertConsistency?.product?.(updated);
        },
        revert: async () => {
          const restored = await provider.products.update({ id, name: originalName });
          if (restored.name !== originalName) {
            throw new Error(
              `fixture product ${id} name could not be restored: ` +
                `expected ${JSON.stringify(originalName)}, got ${JSON.stringify(restored.name)}`,
            );
          }
          await harness.assertConsistency?.product?.(restored);
        },
      });
    });

    // -------------------------------------------------------------------------
    // Scenario 3: update description string→string + revert.
    //
    // Requires a non-null starting description. Because the gating signal lives
    // on the fixture itself (not on the harness config), we read it inside the
    // test body and return early without entering `withFixture` when the
    // description is null. Scenario 4 covers the null path.
    // -------------------------------------------------------------------------
    lazySkipIf(() => !harness?.fixtures?.productId)(
      'update description string→string + revert',
      async () => {
        const id = requireFixture(harness.fixtures?.productId, 'productId');
        const snapshot = await provider.products.get({ id });
        if (snapshot === null) {
          throw new Error(`fixture product ${id} not found`);
        }
        if (snapshot.description === null) {
          // Scenario 4 exercises the null path; skip silently here.
          return;
        }

        let originalDescription = '';
        await withFixture(`product:${id}`, {
          healthCheck: async () => {
            const current = await provider.products.get({ id });
            if (current === null) {
              throw new Error(`fixture product ${id} not found`);
            }
            if (current.active !== true) {
              throw new Error(`fixture product ${id} must start active: true`);
            }
            if (current.description === null) {
              throw new Error(
                `fixture product ${id} description became null between snapshot and health check`,
              );
            }
            originalDescription = current.description;
          },
          test: async () => {
            const newDescription = 'conformance-fixture description';
            expect(newDescription).not.toBe(originalDescription);

            const updated = await provider.products.update({
              id,
              description: newDescription,
            });
            expect(updated.id).toBe(id);
            expect(updated.description).toBe(newDescription);
            expect(updated.active).toBe(true);
            await harness.assertConsistency?.product?.(updated);
          },
          revert: async () => {
            const restored = await provider.products.update({
              id,
              description: originalDescription,
            });
            if (restored.description !== originalDescription) {
              throw new Error(
                `fixture product ${id} description could not be restored: ` +
                  `expected ${JSON.stringify(originalDescription)}, ` +
                  `got ${JSON.stringify(restored.description)}`,
              );
            }
            await harness.assertConsistency?.product?.(restored);
          },
        });
      },
    );

    // -------------------------------------------------------------------------
    // Scenario 4: description null path + revert. Works whether the fixture
    // starts with a non-null or null description.
    // -------------------------------------------------------------------------
    lazySkipIf(() => !harness?.fixtures?.productId)('description null path + revert', async () => {
      const id = requireFixture(harness.fixtures?.productId, 'productId');
      let originalDescription: string | null = null;
      await withFixture(`product:${id}`, {
        healthCheck: async () => {
          const current = await provider.products.get({ id });
          if (current === null) {
            throw new Error(`fixture product ${id} not found`);
          }
          if (current.active !== true) {
            throw new Error(`fixture product ${id} must start active: true`);
          }
          originalDescription = current.description;
        },
        test: async () => {
          if (originalDescription !== null) {
            const cleared = await provider.products.update({ id, description: null });
            await harness.assertConsistency?.product?.(cleared);
            expect(cleared.description).toBeNull();

            const restored = await provider.products.update({
              id,
              description: originalDescription,
            });
            await harness.assertConsistency?.product?.(restored);
            expect(restored.description).toBe(originalDescription);
          } else {
            const fillerDescription = 'conformance-fixture description';
            const set = await provider.products.update({
              id,
              description: fillerDescription,
            });
            await harness.assertConsistency?.product?.(set);
            expect(set.description).toBe(fillerDescription);

            const cleared = await provider.products.update({ id, description: null });
            await harness.assertConsistency?.product?.(cleared);
            expect(cleared.description).toBeNull();
          }
        },
        revert: async () => {
          const final = await provider.products.get({ id });
          if (final === null) {
            throw new Error(`fixture product ${id} disappeared during test`);
          }
          if (final.description !== originalDescription) {
            const corrective = await provider.products.update({
              id,
              description: originalDescription,
            });
            await harness.assertConsistency?.product?.(corrective);
            if (corrective.description !== originalDescription) {
              throw new Error(
                `fixture product ${id} description could not be restored: ` +
                  `expected ${JSON.stringify(originalDescription)}, ` +
                  `got ${JSON.stringify(corrective.description)}`,
              );
            }
          }
        },
      });
    });

    // -------------------------------------------------------------------------
    // Scenario 5: replace metadata + revert.
    // -------------------------------------------------------------------------
    lazySkipIf(() => !harness?.fixtures?.productId)('replace metadata + revert', async () => {
      const id = requireFixture(harness.fixtures?.productId, 'productId');
      let originalMetadata: Metadata = {};
      let originalName = '';
      let originalDescription: string | null = null;
      await withFixture(`product:${id}`, {
        healthCheck: async () => {
          const current = await provider.products.get({ id });
          if (current === null) {
            throw new Error(`fixture product ${id} not found`);
          }
          if (current.active !== true) {
            throw new Error(`fixture product ${id} must start active: true`);
          }
          // Contract invariant: returned metadata never contains reserved keys.
          for (const k of Object.keys(current.metadata)) {
            if (k.startsWith('__provider_')) {
              throw new Error(`fixture product ${id} metadata contains reserved key "${k}"`);
            }
          }
          originalMetadata = cloneMetadata(current.metadata);
          originalName = current.name;
          originalDescription = current.description;
        },
        test: async () => {
          const newMetadata: Metadata = {
            conformance_fixture: 'true',
            scenario: 'metadata_replace',
          };
          const updated = await provider.products.update({ id, metadata: newMetadata });
          expect(updated.metadata).toEqual(newMetadata);
          assertNoReservedKeys(updated.metadata);
          expect(updated.id).toBe(id);
          expect(updated.name).toBe(originalName);
          expect(updated.description).toBe(originalDescription);
          expect(updated.active).toBe(true);
          await harness.assertConsistency?.product?.(updated);
        },
        revert: async () => {
          const restored = await provider.products.update({
            id,
            metadata: originalMetadata,
          });
          if (JSON.stringify(restored.metadata) !== JSON.stringify(originalMetadata)) {
            throw new Error(
              `fixture product ${id} metadata could not be restored: ` +
                `expected ${JSON.stringify(originalMetadata)}, ` +
                `got ${JSON.stringify(restored.metadata)}`,
            );
          }
          assertNoReservedKeys(restored.metadata);
          await harness.assertConsistency?.product?.(restored);
        },
      });
    });

    // -------------------------------------------------------------------------
    // Scenario 6: combined name + description update + revert.
    // -------------------------------------------------------------------------
    lazySkipIf(() => !harness?.fixtures?.productId)(
      'combined name + description update + revert',
      async () => {
        const id = requireFixture(harness.fixtures?.productId, 'productId');
        let originalName = '';
        let originalDescription: string | null = null;
        await withFixture(`product:${id}`, {
          healthCheck: async () => {
            const current = await provider.products.get({ id });
            if (current === null) {
              throw new Error(`fixture product ${id} not found`);
            }
            if (current.active !== true) {
              throw new Error(`fixture product ${id} must start active: true`);
            }
            originalName = current.name;
            originalDescription = current.description;
          },
          test: async () => {
            const newName = `${originalName} (combined)`;
            const newDescription =
              originalDescription === null
                ? 'conformance-fixture combined'
                : `${originalDescription} (combined)`;
            expect(newName).not.toBe(originalName);
            expect(newDescription).not.toBe(originalDescription);

            const updated = await provider.products.update({
              id,
              name: newName,
              description: newDescription,
            });
            expect(updated.id).toBe(id);
            expect(updated.name).toBe(newName);
            expect(updated.description).toBe(newDescription);
            expect(updated.active).toBe(true);
            await harness.assertConsistency?.product?.(updated);
          },
          revert: async () => {
            const restored = await provider.products.update({
              id,
              name: originalName,
              description: originalDescription,
            });
            if (restored.name !== originalName) {
              throw new Error(
                `fixture product ${id} name could not be restored: ` +
                  `expected ${JSON.stringify(originalName)}, ` +
                  `got ${JSON.stringify(restored.name)}`,
              );
            }
            if (restored.description !== originalDescription) {
              throw new Error(
                `fixture product ${id} description could not be restored: ` +
                  `expected ${JSON.stringify(originalDescription)}, ` +
                  `got ${JSON.stringify(restored.description)}`,
              );
            }
            await harness.assertConsistency?.product?.(restored);
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
