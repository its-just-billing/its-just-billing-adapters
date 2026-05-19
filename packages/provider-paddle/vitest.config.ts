import { defineConfig } from 'vitest/config';

/**
 * Paddle's sandbox enforces a strict request rate limit. The adapter throttles
 * and retries (honoring `Retry-After`) at the client boundary, but a single
 * conformance test can still legitimately wait out a multi-second rate-limit
 * window — well past vitest's 5s default. The shared conformance suite (owned
 * by `provider-sdk`) sets no per-test timeouts and must not be edited, so the
 * budget is raised here, at this package's runner config. Hook timeout is
 * likewise generous because per-suite `beforeAll` fixtures provision several
 * resources through the same throttle.
 *
 * Single-fork + no file parallelism keeps every request on one shared limiter
 * so the pacing is global rather than per-worker (multiple workers would each
 * pace independently and collectively blow the sandbox limit).
 */
export default defineConfig({
  test: {
    testTimeout: 120_000,
    hookTimeout: 180_000,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    fileParallelism: false,
  },
});
