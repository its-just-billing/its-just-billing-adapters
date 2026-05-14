import { describe, expect, it } from 'vitest';
import { ProviderConstraintError } from '../../errors/constraint.js';
import { ProviderNormalizationError } from '../../errors/normalization.js';
import {
  assertQuantityWithinConstraint,
  decodeQuantityFromMetadata,
  encodeQuantityToMetadata,
} from '../quantity.js';

describe('encode/decode quantity', () => {
  it('round-trips a bounded constraint', () => {
    const meta = encodeQuantityToMetadata({ min: 1, max: 5 });
    expect(decodeQuantityFromMetadata(meta, 'one_time')).toEqual({ min: 1, max: 5 });
  });

  it('round-trips an unbounded constraint', () => {
    const meta = encodeQuantityToMetadata({ min: 2 });
    expect(decodeQuantityFromMetadata(meta, 'one_time')).toEqual({ min: 2 });
  });

  it('falls back to a permissive default for unmanaged prices (no metadata)', () => {
    // Externally-created prices (no __provider_quantity_* metadata) get a
    // permissive default so the SDK does not pre-reject quantities the
    // provider would otherwise accept.
    expect(decodeQuantityFromMetadata({}, 'recurring')).toEqual({ min: 1, max: 999_999 });
    expect(decodeQuantityFromMetadata({}, 'one_time')).toEqual({ min: 1, max: 999_999 });
    expect(decodeQuantityFromMetadata(undefined, 'recurring')).toEqual({ min: 1, max: 999_999 });
  });

  it('throws normalization error on garbage metadata', () => {
    expect(() => decodeQuantityFromMetadata({ __provider_quantity_min: 'abc' }, 'one_time')).toThrow(
      ProviderNormalizationError,
    );
    expect(() =>
      decodeQuantityFromMetadata(
        { __provider_quantity_min: '5', __provider_quantity_max: '2' },
        'one_time',
      ),
    ).toThrow(ProviderNormalizationError);
  });
});

describe('assertQuantityWithinConstraint', () => {
  it('passes inside the range', () => {
    expect(() => assertQuantityWithinConstraint(3, { min: 1, max: 5 }, 'x')).not.toThrow();
    expect(() => assertQuantityWithinConstraint(7, { min: 1 }, 'x')).not.toThrow();
  });

  it('throws ProviderConstraintError outside the range', () => {
    expect(() => assertQuantityWithinConstraint(0, { min: 1, max: 5 }, 'x')).toThrow(
      ProviderConstraintError,
    );
    expect(() => assertQuantityWithinConstraint(6, { min: 1, max: 5 }, 'x')).toThrow(
      ProviderConstraintError,
    );
    expect(() => assertQuantityWithinConstraint(1.5, { min: 1 }, 'x')).toThrow(
      ProviderConstraintError,
    );
  });
});
