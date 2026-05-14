import { describe, expect, it } from 'vitest';
import { ProviderNotFoundError } from '../../errors/not-found.js';
import { safe } from '../response.js';

describe('safe', () => {
  it('returns ok envelope on success', async () => {
    const result = await safe(async () => 42);
    expect(result).toEqual({ ok: true, status: 200, data: 42 });
  });

  it('returns error envelope with status from ProviderError', async () => {
    const result = await safe(async () => {
      throw new ProviderNotFoundError({ message: 'gone' });
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(404);
      expect(result.error.code).toBe('not_found');
    }
  });

  it('wraps unknown errors as 500', async () => {
    const result = await safe(async () => {
      throw new Error('boom');
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(500);
      expect(result.error.message).toBe('boom');
    }
  });
});
