import type { BillingProvider, ProviderCustomer } from '../index.js';

type CreateInput = Parameters<BillingProvider['customers']['create']>[0];

/**
 * Create a customer fixture for the conformance suites, supplying a unique
 * email when the provider advertises `capabilities.emailRequired` and the
 * caller did not pass one.
 *
 * This is deliberately *test scaffolding* — the suite owns its own fixtures,
 * so it may pick a valid email for an email-mandatory provider. That is a
 * different thing from an adapter fabricating an email behind the caller's
 * back: the `emailRequired` capability exists precisely so the adapter
 * rejects a missing email instead of inventing a dead address. Tests that
 * specifically assert the no-email contract still call
 * `provider.customers.create({})` directly and gate on the capability.
 */
export async function createConformanceCustomer(
  provider: BillingProvider,
  input: CreateInput = {},
): Promise<ProviderCustomer> {
  const needsEmail =
    provider.capabilities.emailRequired === true &&
    (input as { email?: unknown }).email === undefined;
  return provider.customers.create(
    needsEmail
      ? {
          ...input,
          email: `conf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`,
        }
      : input,
  );
}
