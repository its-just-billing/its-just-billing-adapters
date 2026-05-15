import type { ConformanceSuite, ProviderTestHarness } from './harness.js';
import { registerAutomatedSuite } from './suites/automated/index.js';
import { registerFixtureSuite } from './suites/fixture/index.js';
import { registerSelfSetupSuite } from './suites/self-setup/index.js';
import { registerSemiManualSuite } from './suites/semi-manual/index.js';

type HarnessFactory = () => ProviderTestHarness | Promise<ProviderTestHarness>;

export interface DescribeConformanceOptions {
  suites: ConformanceSuite[];
}

/**
 * Register one or more conformance suites against a provider harness. Call
 * this at the top level of a vitest test file:
 *
 * ```ts
 * import { describeConformance } from '@its-just-billing/provider-sdk/conformance';
 * import { createMockProvider } from '../src/index.js';
 *
 * describeConformance('mock', () => ({
 *   label: 'mock',
 *   provider: createMockProvider(),
 * }), { suites: ['automated', 'self-setup'] });
 * ```
 *
 * The factory is invoked once per top-level describe; suites set up their
 * own per-test fixtures via beforeEach as needed.
 */
export function describeConformance(
  label: string,
  factory: HarnessFactory,
  options: DescribeConformanceOptions,
): void {
  for (const suite of options.suites) {
    switch (suite) {
      case 'automated':
        registerAutomatedSuite(label, factory);
        break;
      case 'self-setup':
        registerSelfSetupSuite(label, factory);
        break;
      case 'semi-manual':
        registerSemiManualSuite(label, factory);
        break;
      case 'fixture':
        registerFixtureSuite(label, factory);
        break;
    }
  }
}
