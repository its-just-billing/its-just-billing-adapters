import { describe, expect, it, vi } from 'vitest';
import type { Page } from '../../models/page.js';
import { paginate } from '../paginate.js';

describe('paginate', () => {
  it('yields items from a single page when nextCursor is null', async () => {
    const fetch = vi.fn(
      async (): Promise<Page<number>> => ({ data: [1, 2, 3], nextCursor: null }),
    );
    const out: number[] = [];
    for await (const item of paginate(fetch)) out.push(item);
    expect(out).toEqual([1, 2, 3]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(undefined);
  });

  it('walks pages until nextCursor is null', async () => {
    const pages: Page<number>[] = [
      { data: [1, 2], nextCursor: 'c1' },
      { data: [3, 4], nextCursor: 'c2' },
      { data: [5], nextCursor: null },
    ];
    const calls: (string | undefined)[] = [];
    const fetch = async (cursor: string | undefined): Promise<Page<number>> => {
      calls.push(cursor);
      return pages.shift()!;
    };
    const out: number[] = [];
    for await (const item of paginate(fetch)) out.push(item);
    expect(out).toEqual([1, 2, 3, 4, 5]);
    expect(calls).toEqual([undefined, 'c1', 'c2']);
  });

  it('stops fetching when the consumer breaks early', async () => {
    const fetch = vi.fn(async (cursor: string | undefined): Promise<Page<number>> => {
      if (cursor === undefined) return { data: [1, 2, 3], nextCursor: 'c1' };
      return { data: [99], nextCursor: null };
    });
    for await (const item of paginate(fetch)) {
      if (item === 2) break;
    }
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('handles an empty first page', async () => {
    const fetch = async (): Promise<Page<number>> => ({ data: [], nextCursor: null });
    const out: number[] = [];
    for await (const item of paginate(fetch)) out.push(item);
    expect(out).toEqual([]);
  });

  it('propagates errors from fetchPage', async () => {
    const fetch = async (): Promise<Page<number>> => {
      throw new Error('boom');
    };
    await expect(async () => {
      for await (const _ of paginate(fetch)) {
        // noop
      }
    }).rejects.toThrow('boom');
  });
});
