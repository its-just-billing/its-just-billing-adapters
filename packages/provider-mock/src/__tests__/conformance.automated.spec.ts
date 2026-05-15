import { describeConformance } from '@its-just-billing/provider-sdk/conformance';
import { createMockHarness } from '../harness.js';

describeConformance('mock', () => createMockHarness({ seedFixtures: false }), {
  suites: ['automated'],
});
