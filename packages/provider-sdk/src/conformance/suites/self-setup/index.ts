import { describe } from 'vitest';
import type { ProviderTestHarness } from '../../harness.js';
import { registerPaymentsSelfSetupSuite } from './payments.js';
import { registerSubscriptionsSelfSetupSuite } from './subscriptions.js';

type HarnessFactory = () => ProviderTestHarness | Promise<ProviderTestHarness>;

/**
 * Register the "self-setup" conformance suite. Tests here depend on the
 * harness exposing `setup.*` capabilities; each test must guard on the
 * specific capability it uses and skip when absent.
 */
export function registerSelfSetupSuite(label: string, factory: HarnessFactory): void {
  describe(`[self-setup] ${label}`, () => {
    registerSubscriptionsSelfSetupSuite(label, factory);
    registerPaymentsSelfSetupSuite(label, factory);
  });
}
