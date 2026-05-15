/**
 * Mock ID generator. Each call returns a fresh string with the given prefix.
 * Counter + per-process randomness yields distinct, sortable, recognizable
 * IDs across the lifetime of a provider instance.
 */
let counter = 0;
const seed = Math.random().toString(36).slice(2, 8);

export function nextId(prefix: string): string {
  counter += 1;
  return `${prefix}_mock_${counter.toString(36)}${seed}`;
}
