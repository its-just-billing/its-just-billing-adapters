import { describeConformance } from '@its-just-billing/provider-sdk/conformance';
import { describe } from 'vitest';
import { createPaddleHarness } from '../harness.js';

// The semi-manual suite additionally self-skips unless INTERACTIVE=1. With a
// key + INTERACTIVE=1 it drives a hosted checkout; press O to open it.
if (process.env.PADDLE_TEST_API_KEY) {
  describeConformance('paddle', () => createPaddleHarness(), {
    suites: ['semi-manual'],
  });
} else {
  describe.skip('paddle conformance (semi-manual) — PADDLE_TEST_API_KEY not set', () => {});
}
