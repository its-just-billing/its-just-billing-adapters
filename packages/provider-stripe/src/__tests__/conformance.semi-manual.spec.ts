import { describeConformance } from '@its-just-billing/provider-sdk/conformance';
import { describe } from 'vitest';
import { createStripeHarness } from '../harness.js';

// The semi-manual suite additionally self-skips unless INTERACTIVE=1 (see
// suites/semi-manual/index.ts), so this is inert in normal CI even with a key.
if (process.env.STRIPE_TEST_API_KEY) {
  describeConformance('stripe', () => createStripeHarness(), {
    suites: ['semi-manual'],
  });
} else {
  describe.skip('stripe conformance (semi-manual) — STRIPE_TEST_API_KEY not set', () => {});
}
