/**
 * Drop the optional `raw` escape-hatch field for round-trip equality checks.
 *
 * Normalized records expose `raw` so callers can reach provider-native data
 * when the contract doesn't cover their use case. Two separate provider calls
 * (e.g. `create` and a fresh `get`) can legitimately return different native
 * objects — Stripe may include slightly different fields, Paddle may reorder
 * arrays — while every normalized field still agrees. Conformance tests that
 * want to assert "create returned the same record as get" should compare only
 * the normalized shape; stripping `raw` is how they say so.
 *
 * `presentation` on checkout sessions is intentionally NOT stripped: it is
 * part of the normalized contract (every session has one) and tests already
 * compare it field-by-field rather than via full-object equality.
 */
export function withoutRaw<T extends { raw?: unknown }>(record: T): Omit<T, 'raw'> {
  const { raw: _raw, ...rest } = record;
  return rest;
}
