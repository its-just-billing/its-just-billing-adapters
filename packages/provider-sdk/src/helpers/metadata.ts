import { MetadataCollisionError } from '../errors/metadata-collision.js';
import { findReservedKeys, type Metadata } from '../models/metadata.js';

/**
 * Throws MetadataCollisionError (422) if caller metadata contains any reserved
 * `__provider_*` keys. Call this before invoking the provider API.
 */
export function assertNoReservedKeys(metadata: Metadata | undefined, methodLabel: string): void {
  const reserved = findReservedKeys(metadata);
  if (reserved.length === 0) return;
  throw new MetadataCollisionError({
    message: `Caller metadata for ${methodLabel} uses reserved keys: ${reserved.join(', ')}`,
    reservedKeys: reserved,
  });
}

/**
 * Strips all reserved-prefix keys out of a metadata record before exposing it
 * to a caller. Adapters use this to hide adapter-managed keys from normalized
 * output.
 */
export function stripReservedKeys(metadata: Metadata | undefined): Metadata {
  if (!metadata) return {};
  const out: Metadata = {};
  for (const [k, v] of Object.entries(metadata)) {
    if (!k.startsWith('__provider_')) out[k] = v;
  }
  return out;
}
