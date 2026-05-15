/**
 * Runner support for the `fixture` conformance suite. Tests in that suite
 * exercise pre-provisioned resources whose IDs come from the harness
 * `fixtures` field. Each test asserts the resource is in an expected clean
 * starting state, runs its scenario, then reverts.
 *
 * If a revert fails, the fixture is marked dirty for the rest of the process.
 * Subsequent uses of the same fixture fail fast with a clear "manual cleanup
 * required" message rather than producing misleading downstream failures.
 */

const dirtyFixtures = new Set<string>();

export interface WithFixtureOptions {
  /**
   * Throws (with a descriptive message) if the resource is not in the
   * expected clean starting state. Use the message to instruct the operator
   * how to fix the fixture or replace it with a fresh one.
   */
  healthCheck(): Promise<void>;
  /** Run the test against the fixture. May mutate state. */
  test(): Promise<void>;
  /**
   * Restore the fixture to the expected clean starting state. The runner
   * calls this whether the test passed or threw. If revert itself throws,
   * the fixture is marked dirty and future uses fail fast.
   */
  revert(): Promise<void>;
}

/**
 * Wrap a fixture-based test so the fixture is health-checked before, exercised
 * during, and reverted after.
 *
 * ```ts
 * await withFixture(`subscription:${id}`, {
 *   healthCheck: async () => {
 *     const sub = await provider.subscriptions.get({ id });
 *     if (!sub) throw new Error('not found');
 *     if (sub.cancelAtPeriodEnd) throw new Error('already cancelling');
 *   },
 *   test: async () => {
 *     const cancelled = await provider.subscriptions.cancel({ id, when: 'at_period_end' });
 *     expect(cancelled.cancelAtPeriodEnd).toBe(true);
 *   },
 *   revert: async () => {
 *     await provider.subscriptions.cancelScheduledChange({ id });
 *   },
 * });
 * ```
 */
export async function withFixture(fixtureKey: string, opts: WithFixtureOptions): Promise<void> {
  if (dirtyFixtures.has(fixtureKey)) {
    throw new Error(
      `Fixture "${fixtureKey}" is dirty from a prior failed revert. Manually recreate the resource and update the harness fixtures config.`,
    );
  }

  try {
    await opts.healthCheck();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Fixture "${fixtureKey}" is not in the expected starting state:\n  ${message}\nEither fix the resource manually or replace it with a fresh one.`,
    );
  }

  let testErr: unknown;
  try {
    await opts.test();
  } catch (e) {
    testErr = e;
  }

  try {
    await opts.revert();
  } catch (revertErr) {
    dirtyFixtures.add(fixtureKey);
    const message = revertErr instanceof Error ? revertErr.message : String(revertErr);
    throw new Error(
      `Fixture "${fixtureKey}" revert failed${testErr ? ' after a failing test' : ''}: ${message}\nManual cleanup required. Subsequent fixture tests will fail fast.`,
    );
  }

  if (testErr) throw testErr;
}

/** Test-only: clear the dirty set. Not exported from the package entrypoint. */
export function _resetDirtyFixturesForTests(): void {
  dirtyFixtures.clear();
}
