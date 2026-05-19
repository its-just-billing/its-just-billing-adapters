import { describeConformance } from '@its-just-billing/provider-sdk/conformance';
import { describe } from 'vitest';
import { createPaddleHarness } from '../harness.js';

// Paddle exposes no `setup.createSubscription`/`completePayment`, so the
// self-setup subscription/payment tests skip cleanly; other self-setup
// coverage still runs.
if (process.env.PADDLE_TEST_API_KEY) {
  describeConformance('paddle', () => createPaddleHarness(), {
    suites: ['self-setup'],
  });
} else {
  describe.skip('paddle conformance (self-setup) — PADDLE_TEST_API_KEY not set', () => {});
}
