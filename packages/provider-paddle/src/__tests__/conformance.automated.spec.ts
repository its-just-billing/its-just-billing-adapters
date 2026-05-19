import { describeConformance } from '@its-just-billing/provider-sdk/conformance';
import { describe } from 'vitest';
import { createPaddleHarness } from '../harness.js';

if (process.env.PADDLE_TEST_API_KEY) {
  describeConformance('paddle', () => createPaddleHarness(), {
    suites: ['automated'],
  });
} else {
  describe.skip('paddle conformance (automated) — PADDLE_TEST_API_KEY not set', () => {});
}
