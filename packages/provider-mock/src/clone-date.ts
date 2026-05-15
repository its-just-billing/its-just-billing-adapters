/**
 * Mock normalizers return Date objects to callers. If we return the same Date
 * instance held in the internal store, a caller could mutate provider state
 * via the response (e.g. `c.createdAt.setTime(0)`). Cloning each Date on the
 * way out keeps the store immutable from the caller's perspective, mirroring
 * how metadata and item arrays are already cloned.
 */
export function cloneDate(d: Date): Date;
export function cloneDate(d: Date | null): Date | null;
export function cloneDate(d: Date | null): Date | null {
  return d === null ? null : new Date(d.getTime());
}
