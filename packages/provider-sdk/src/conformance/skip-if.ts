import { it } from 'vitest';

/**
 * Conformance suites use `let harness!: ProviderTestHarness` populated in
 * `beforeAll`; gating tests via vitest's `it.skipIf(!harness?.x?.y)` doesn't
 * work because vitest evaluates the predicate at register time — when the
 * describe body runs and `harness` is still uninitialized — so every gated
 * test would always skip.
 *
 * `lazySkipIf` defers the predicate to test runtime: the registered test
 * always exists, but inside its body the predicate is re-evaluated against
 * the now-populated `harness`. When the predicate is truthy the test calls
 * `ctx.skip()` for a clean skip; otherwise the original test body runs.
 *
 * Drop-in substitute: replace `it.skipIf(EXPR)` with `lazySkipIf(() => EXPR)`.
 */
export function lazySkipIf(predicate: () => boolean) {
  return (
    name: string,
    fn: (ctx: { skip: () => void }) => void | Promise<void>,
    timeout?: number,
  ): void => {
    it(
      name,
      async (ctx) => {
        if (predicate()) {
          ctx.skip();
          return;
        }
        await fn(ctx);
      },
      timeout,
    );
  };
}

/**
 * Narrow an optional fixture id to its non-nullable form inside a test body.
 *
 * Conformance fixture tests gate registration on
 * `lazySkipIf(() => !harness?.fixtures?.<id>)`, so by the time the test body
 * runs we know the fixture exists — but TypeScript can't follow that
 * runtime invariant. `requireFixture` lets the test read the fixture without
 * non-null assertions (`harness.fixtures!.customerId!`), which the repo's
 * Biome config flags via `noNonNullAssertion`. If the predicate is somehow
 * wrong and the fixture is missing, the throw makes the contract violation
 * obvious instead of producing a confusing downstream TypeError.
 */
export function requireFixture<T>(value: T | null | undefined, label: string): T {
  if (value === null || value === undefined) {
    throw new Error(
      `Fixture "${label}" was expected to be present but is missing — this code path should have been gated by lazySkipIf.`,
    );
  }
  return value;
}

/**
 * Narrow `T | null | undefined` to `T` for a value populated earlier in the
 * test lifecycle (e.g. a snapshot captured by a `withFixture` healthCheck and
 * then read in the test/revert phases). Throws with a clear label if the value
 * is missing, which signals a contract violation in the upstream setup rather
 * than a runtime TypeError in the consumer.
 */
export function nonNull<T>(value: T | null | undefined, label: string): T {
  if (value === null || value === undefined) {
    throw new Error(`Expected "${label}" to be defined at this point but it is null/undefined.`);
  }
  return value;
}
