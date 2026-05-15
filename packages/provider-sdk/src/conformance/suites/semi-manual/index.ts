import { describe } from 'vitest';
import type { ProviderTestHarness } from '../../harness.js';
import { isInteractiveMode } from '../../prompts.js';
import { registerPaymentsSemiManualSuite } from './payments.js';

type HarnessFactory = () => ProviderTestHarness | Promise<ProviderTestHarness>;

/**
 * Register the "semi-manual" conformance suite. Tests here use
 * `harness.prompt(...)` to ask the dev to perform a setup action (open a
 * checkout, complete a payment) and then assert on the resulting state.
 *
 * The whole suite is skipped unless `INTERACTIVE=1` is in the environment.
 */
export function registerSemiManualSuite(label: string, factory: HarnessFactory): void {
  describe.skipIf(!isInteractiveMode())(`[semi-manual] ${label}`, () => {
    registerPaymentsSemiManualSuite(label, factory);
  });
}
