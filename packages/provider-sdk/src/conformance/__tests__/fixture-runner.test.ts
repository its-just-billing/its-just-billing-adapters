import { afterEach, describe, expect, it, vi } from 'vitest';
import { _resetDirtyFixturesForTests, withFixture } from '../fixture-runner.js';

describe('withFixture', () => {
  afterEach(() => {
    _resetDirtyFixturesForTests();
  });

  it('runs healthCheck → test → revert in order on the happy path', async () => {
    const calls: string[] = [];
    await withFixture('sub:happy', {
      healthCheck: async () => {
        calls.push('health');
      },
      test: async () => {
        calls.push('test');
      },
      revert: async () => {
        calls.push('revert');
      },
    });
    expect(calls).toEqual(['health', 'test', 'revert']);
  });

  it('refuses to run when the fixture is already dirty', async () => {
    // Force the fixture dirty by triggering a failed revert.
    await expect(
      withFixture('sub:dirty', {
        healthCheck: async () => {},
        test: async () => {},
        revert: async () => {
          throw new Error('revert exploded');
        },
      }),
    ).rejects.toThrow(/revert failed/);

    // Subsequent use of the same key fails fast with the dirty message.
    const second = vi.fn(async () => {});
    await expect(
      withFixture('sub:dirty', {
        healthCheck: second,
        test: second,
        revert: second,
      }),
    ).rejects.toThrow(/dirty from a prior failed revert/);
    expect(second).not.toHaveBeenCalled();
  });

  it('reports unhealthy starting state with a helpful message', async () => {
    await expect(
      withFixture('sub:unhealthy', {
        healthCheck: async () => {
          throw new Error('status is canceled, expected active');
        },
        test: async () => {},
        revert: async () => {},
      }),
    ).rejects.toThrow(/not in the expected starting state[\s\S]*status is canceled/);
  });

  it('still runs revert when the test throws, and propagates the test error', async () => {
    const revert = vi.fn(async () => {});
    await expect(
      withFixture('sub:test-fail', {
        healthCheck: async () => {},
        test: async () => {
          throw new Error('test exploded');
        },
        revert,
      }),
    ).rejects.toThrow(/test exploded/);
    expect(revert).toHaveBeenCalledTimes(1);
  });

  it('marks fixture dirty when revert fails after a test failure, surfaces the revert error', async () => {
    await expect(
      withFixture('sub:both-fail', {
        healthCheck: async () => {},
        test: async () => {
          throw new Error('test exploded');
        },
        revert: async () => {
          throw new Error('revert exploded too');
        },
      }),
    ).rejects.toThrow(/revert failed after a failing test[\s\S]*revert exploded too/);

    // And the fixture is now dirty.
    await expect(
      withFixture('sub:both-fail', {
        healthCheck: async () => {},
        test: async () => {},
        revert: async () => {},
      }),
    ).rejects.toThrow(/dirty from a prior failed revert/);
  });
});
