import { describeConformance } from '@its-just-billing/provider-sdk/conformance';
import { describe } from 'vitest';
import { createStripeHarness } from '../harness.js';

if (process.env.STRIPE_TEST_API_KEY) {
  describeConformance('stripe', () => createStripeHarness(), {
    suites: ['self-setup'],
  });
} else {
  describe.skip('stripe conformance (self-setup) — STRIPE_TEST_API_KEY not set', () => {});
}
