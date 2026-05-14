import { describe, expect, it } from 'vitest';
import { MetadataCollisionError } from '../../errors/metadata-collision.js';
import { assertNoReservedKeys, stripReservedKeys } from '../metadata.js';

describe('assertNoReservedKeys', () => {
  it('does nothing when metadata is empty or undefined', () => {
    expect(() => assertNoReservedKeys(undefined, 'x.create')).not.toThrow();
    expect(() => assertNoReservedKeys({}, 'x.create')).not.toThrow();
  });

  it('does nothing when no keys are reserved', () => {
    expect(() => assertNoReservedKeys({ foo: 'bar' }, 'x.create')).not.toThrow();
  });

  it('throws MetadataCollisionError on reserved key', () => {
    try {
      assertNoReservedKeys({ __provider_quantity_min: '1' }, 'x.create');
      throw new Error('should not reach');
    } catch (err) {
      expect(err).toBeInstanceOf(MetadataCollisionError);
      const e = err as MetadataCollisionError;
      expect(e.status).toBe(422);
      expect(e.reservedKeys).toEqual(['__provider_quantity_min']);
    }
  });
});

describe('stripReservedKeys', () => {
  it('removes all reserved-prefix keys', () => {
    const out = stripReservedKeys({
      foo: 'bar',
      __provider_quantity_min: '1',
      __provider_quantity_max: '5',
    });
    expect(out).toEqual({ foo: 'bar' });
  });

  it('returns {} for undefined input', () => {
    expect(stripReservedKeys(undefined)).toEqual({});
  });
});
