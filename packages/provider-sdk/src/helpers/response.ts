import { ProviderError, isProviderError } from '../errors/base.js';

export type ProviderResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; error: ProviderError };

/**
 * Wrap any provider call into a result envelope. Provider methods throw
 * normalized errors by default; this helper offers branching ergonomics for
 * callers that prefer explicit success/failure handling.
 *
 * ```ts
 * const result = await safe(() => provider.customers.get({ id }));
 * if (!result.ok) return reply.code(result.status).send(result.error.toJSON());
 * ```
 */
export async function safe<T>(fn: () => Promise<T>): Promise<ProviderResult<T>> {
  try {
    const data = await fn();
    return { ok: true, status: 200, data };
  } catch (err) {
    if (isProviderError(err)) {
      return { ok: false, status: err.status, error: err };
    }
    const wrapped = new ProviderError({
      status: 500,
      code: 'unknown',
      message: err instanceof Error ? err.message : 'Unknown provider failure',
      cause: err,
    });
    return { ok: false, status: 500, error: wrapped };
  }
}
