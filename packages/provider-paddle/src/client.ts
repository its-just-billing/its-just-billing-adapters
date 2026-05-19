import { Environment, Paddle } from '@paddle/paddle-node-sdk';
import { wrapPaddleWithRateLimiting } from './rate-limit.js';

export interface CreatePaddleClientOptions {
  /** Paddle API key (sandbox `pdl_sdbx_...` or live `pdl_live_...`). */
  apiKey: string;
  /** Target Paddle environment. Defaults to `sandbox`. */
  environment?: Environment;
  /** Existing Paddle client to reuse (tests). When set, other opts ignored. */
  client?: Paddle;
}

/**
 * Construct (or pass through) the underlying Paddle Billing client. Defaults
 * to the sandbox environment — the live environment must be opted into
 * explicitly so a misconfigured key can't accidentally hit production.
 *
 * The returned client is always wrapped with transparent throttling +
 * retry-on-429 (see `rate-limit.ts`); the wrap is idempotent, so passing an
 * already-wrapped `opts.client` reuses its shared limiter.
 */
export function createPaddleClient(opts: CreatePaddleClientOptions): Paddle {
  const base =
    opts.client ??
    new Paddle(opts.apiKey, {
      environment: opts.environment ?? Environment.sandbox,
    });
  return wrapPaddleWithRateLimiting(base);
}
