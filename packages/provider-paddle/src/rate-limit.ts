import type { Paddle } from '@paddle/paddle-node-sdk';
import { isPaddleRateLimit, paddleRetryAfterSeconds } from './error-mapping.js';

/**
 * Paddle Billing enforces a request rate limit (and the sandbox is tighter
 * than live). The conformance suite fires hundreds of calls back-to-back, so
 * without pacing the account is rate-limited and every dependent test
 * cascade-fails. Two complementary defenses, both applied transparently at
 * the client boundary so domain code stays a plain pass-through:
 *
 *  1. **Throttle** — every Paddle request is funneled through a serialized
 *     queue with a minimum inter-request gap, smoothing bursts so the limit
 *     is rarely hit in the first place.
 *  2. **Retry** — a request that still 429s is retried, honoring Paddle's
 *     `Retry-After` (falling back to capped exponential backoff), up to a
 *     bounded number of attempts. Non-rate-limit errors propagate unchanged
 *     so `mapPaddleError` classifies them normally.
 *
 * Tunable via env for CI vs. local: `PADDLE_MIN_REQUEST_INTERVAL_MS`,
 * `PADDLE_MAX_RETRIES`.
 */

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

const MIN_INTERVAL_MS = envInt('PADDLE_MIN_REQUEST_INTERVAL_MS', 90);
const MAX_RETRIES = envInt('PADDLE_MAX_RETRIES', 12);
const BASE_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 60_000;

class RateLimiter {
  private tail: Promise<unknown> = Promise.resolve();
  private lastStartedAt = 0;

  /**
   * Run `thunk` after the queue ahead of it drains and the minimum gap has
   * elapsed, retrying on rate-limit responses. Serialized: one Paddle request
   * is in flight at a time, which is plenty for the conformance suite and
   * makes the pacing trivially correct.
   */
  schedule<T>(thunk: () => Promise<T>): Promise<T> {
    const result = this.tail.then(() => this.runWithRetry(thunk));
    // Keep the chain progressing whether or not this call settled OK, and
    // never leak an unhandled rejection from the internal chain handle.
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async pace(): Promise<void> {
    const wait = MIN_INTERVAL_MS - (Date.now() - this.lastStartedAt);
    if (wait > 0) await sleep(wait);
    this.lastStartedAt = Date.now();
  }

  private async runWithRetry<T>(thunk: () => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      await this.pace();
      try {
        return await thunk();
      } catch (err) {
        if (!isPaddleRateLimit(err) || attempt >= MAX_RETRIES) throw err;
        const retryAfter = paddleRetryAfterSeconds(err);
        const backoff = Math.min(BASE_BACKOFF_MS * 2 ** attempt, MAX_BACKOFF_MS);
        const waitMs =
          retryAfter !== undefined ? Math.min(retryAfter * 1_000 + 250, MAX_BACKOFF_MS) : backoff;
        await sleep(waitMs);
      }
    }
    // Unreachable: the final attempt either returns or throws above.
    throw new Error('rate-limit retry loop exhausted unexpectedly');
  }
}

/** One shared limiter per underlying Paddle instance (survives re-wrapping). */
const LIMITERS = new WeakMap<object, RateLimiter>();
const WRAPPED = new WeakSet<object>();

// Network-backed resources we route through the limiter. `webhooks`
// (signature verification — local, synchronous) and anything unlisted are
// intentionally left untouched.
const THROTTLED_RESOURCES = new Set([
  'customers',
  'products',
  'prices',
  'subscriptions',
  'transactions',
  'discounts',
  'events',
  'notificationSettings',
  'adjustments',
  'clientTokens',
]);

// `*.list` returns a lazy `Collection` (the request fires on `.next()`), so
// we wrap the collection's `next` instead of the `list` call — except
// `notificationSettings.list`, which returns a `Promise<[]>` directly.
function isCollectionList(resourceName: string, method: string): boolean {
  return method === 'list' && resourceName !== 'notificationSettings';
}

function wrapResource(resourceName: string, resource: object, limiter: RateLimiter): object {
  return new Proxy(resource, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== 'function' || typeof prop !== 'string') return value;
      const method = prop;

      if (isCollectionList(resourceName, method)) {
        return (...args: unknown[]) => {
          const collection = (value as (...a: unknown[]) => unknown).apply(target, args) as {
            next: (...a: unknown[]) => Promise<unknown>;
          };
          const originalNext = collection.next.bind(collection);
          collection.next = (...a: unknown[]) => limiter.schedule(() => originalNext(...a));
          return collection;
        };
      }

      return (...args: unknown[]) =>
        limiter.schedule(() =>
          (value as (...a: unknown[]) => Promise<unknown>).apply(target, args),
        );
    },
  });
}

/**
 * Wrap a Paddle client so every network call is throttled + retried on 429.
 * Idempotent and instance-keyed: wrapping the same underlying client twice
 * (e.g. the harness wraps it, then `createPaddleClient` sees it as
 * `opts.client`) reuses the one shared limiter, so the harness's
 * consistency-check calls and the adapter's calls pace against each other.
 */
export function wrapPaddleWithRateLimiting(paddle: Paddle): Paddle {
  if (WRAPPED.has(paddle)) return paddle;
  let limiter = LIMITERS.get(paddle);
  if (!limiter) {
    limiter = new RateLimiter();
    LIMITERS.set(paddle, limiter);
  }
  const sharedLimiter = limiter;
  const resourceCache = new Map<string, object>();

  const wrapped = new Proxy(paddle, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (
        typeof prop === 'string' &&
        THROTTLED_RESOURCES.has(prop) &&
        value !== null &&
        typeof value === 'object'
      ) {
        let proxied = resourceCache.get(prop);
        if (!proxied) {
          proxied = wrapResource(prop, value, sharedLimiter);
          resourceCache.set(prop, proxied);
        }
        return proxied;
      }
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });

  WRAPPED.add(wrapped);
  LIMITERS.set(wrapped, sharedLimiter);
  return wrapped;
}
