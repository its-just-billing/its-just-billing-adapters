import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ProviderValidationError } from '../../errors/validation.js';
import { validate } from '../validate.js';

describe('validate', () => {
  const schema = z.object({ id: z.string().min(1), count: z.number().int().positive() });

  it('returns parsed data on success', () => {
    const result = validate(schema, { id: 'x', count: 2 }, 'thing.do');
    expect(result).toEqual({ id: 'x', count: 2 });
  });

  it('throws ProviderValidationError with 400 status on failure', () => {
    try {
      validate(schema, { id: '', count: -1 }, 'thing.do');
      throw new Error('should not reach');
    } catch (err) {
      expect(err).toBeInstanceOf(ProviderValidationError);
      const v = err as ProviderValidationError;
      expect(v.status).toBe(400);
      expect(v.code).toBe('validation');
      expect(v.issues.length).toBeGreaterThan(0);
      expect(v.message).toContain('thing.do');
    }
  });

  it('rejects arbitrary unknown shape', () => {
    expect(() => validate(schema, 'not-an-object', 'thing.do')).toThrow(ProviderValidationError);
    expect(() => validate(schema, null, 'thing.do')).toThrow(ProviderValidationError);
    expect(() => validate(schema, undefined, 'thing.do')).toThrow(ProviderValidationError);
  });
});
