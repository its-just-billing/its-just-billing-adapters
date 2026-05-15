/**
 * Defensive clone for Date values returned to callers. Stripe surfaces times
 * as unix-seconds integers, so we construct a fresh Date per response anyway —
 * but normalize helpers may pass the same instance through more than one place
 * (e.g. when a parent normalizer threads a Date into a child). Cloning at the
 * outer boundary keeps callers from mutating any internal references.
 */
export function cloneDate(d: Date): Date;
export function cloneDate(d: Date | null): Date | null;
export function cloneDate(d: Date | null): Date | null {
  return d === null ? null : new Date(d.getTime());
}

/**
 * Convert a Stripe unix-seconds timestamp to a Date.
 */
export function fromUnixSeconds(secs: number): Date {
  return new Date(secs * 1000);
}
