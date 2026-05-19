import { describeConformance } from '@its-just-billing/provider-sdk/conformance';
import { describe } from 'vitest';
import { createPaddleHarness } from '../harness.js';

// Paddle's subscription lifecycle is covered here against a hand-provisioned
// long-lived subscription (it can't bootstrap one via the API). Tests skip
// unless a pinned subscription id is resolvable (env / fixture-resources.json).
if (process.env.PADDLE_TEST_API_KEY) {
  describeConformance('paddle', () => createPaddleHarness({ fixtures: true }), {
    suites: ['fixture'],
  });
} else {
  describe.skip('paddle conformance (fixture) — PADDLE_TEST_API_KEY not set', () => {});
}
