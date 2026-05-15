import { ProviderConstraintError } from '../errors/constraint.js';
import { ProviderNormalizationError } from '../errors/normalization.js';
import { RESERVED_METADATA_KEYS } from '../models/metadata.js';
import { type PriceKind, type Quantity, isQuantityWithinConstraint } from '../models/quantity.js';

/**
 * Permissive quantity constraint applied when a price is read from a provider
 * with no adapter-managed quantity metadata — i.e. the price was created
 * outside the SDK and has no authored constraint. The upper bound matches
 * Stripe's documented per-line-item maximum so the SDK doesn't claim more
 * than the provider would actually accept.
 *
 * This is read-only fallback semantics. SDK-created prices always have
 * managed metadata and use the caller-supplied or per-kind default constraint.
 */
export const UNMANAGED_QUANTITY_DEFAULT: Quantity = { min: 1, max: 999_999 };

/**
 * Encode a normalized quantity into reserved adapter-managed metadata keys.
 * Returns the metadata to merge into the provider-native object.
 */
export function encodeQuantityToMetadata(quantity: Quantity): Record<string, string> {
  const out: Record<string, string> = {
    [RESERVED_METADATA_KEYS.QUANTITY_MIN]: String(quantity.min),
  };
  if (typeof quantity.max === 'number') {
    out[RESERVED_METADATA_KEYS.QUANTITY_MAX] = String(quantity.max);
  }
  return out;
}

/**
 * Decode quantity from adapter-managed metadata. When no constraint metadata
 * is present — typically because the price was created outside the SDK —
 * falls back to `UNMANAGED_QUANTITY_DEFAULT` (`{ min: 1, max: 999_999 }`).
 * The `kind` parameter is retained for future use but the unmanaged fallback
 * is intentionally kind-agnostic: claiming a tighter constraint on a price
 * the SDK didn't author would cause it to pre-reject quantities the provider
 * would actually accept.
 *
 * Throws `ProviderNormalizationError` for malformed managed metadata so
 * corruption never silently weakens authored limits.
 */
export function decodeQuantityFromMetadata(
  metadata: Record<string, string> | undefined,
  _kind: PriceKind,
): Quantity {
  const rawMin = metadata?.[RESERVED_METADATA_KEYS.QUANTITY_MIN];
  const rawMax = metadata?.[RESERVED_METADATA_KEYS.QUANTITY_MAX];

  if (rawMin === undefined && rawMax === undefined) return { ...UNMANAGED_QUANTITY_DEFAULT };

  const min = rawMin !== undefined ? Number(rawMin) : 1;
  if (!Number.isInteger(min) || min < 1) {
    throw new ProviderNormalizationError({
      message: `Invalid managed quantity_min: ${rawMin}`,
    });
  }

  if (rawMax === undefined) return { min };

  const max = Number(rawMax);
  if (!Number.isInteger(max) || max < min) {
    throw new ProviderNormalizationError({
      message: `Invalid managed quantity_max: ${rawMax} (min=${min})`,
    });
  }
  return { min, max };
}

/**
 * Validate a concrete quantity value against a normalized constraint. Throws
 * ProviderConstraintError (422) if the value is outside the range.
 */
export function assertQuantityWithinConstraint(
  value: number,
  quantity: Quantity,
  methodLabel: string,
): void {
  if (!isQuantityWithinConstraint(value, quantity)) {
    throw new ProviderConstraintError({
      message: `Quantity ${value} is outside the allowed range for ${methodLabel}`,
      details: { quantity, value },
    });
  }
}
