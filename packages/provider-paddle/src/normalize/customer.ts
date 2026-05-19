import type { ProviderCustomer } from '@its-just-billing/provider-sdk';
import type { Customer } from '@paddle/paddle-node-sdk';
import { paddleCustomDataToMetadata } from '../metadata.js';

/**
 * Paddle customer → normalized ProviderCustomer. Caller-visible metadata is
 * stripped of `__provider_*` keys (handled inside
 * {@link paddleCustomDataToMetadata}); `raw` retains the full native object.
 *
 * Paddle always has a real, non-null `email` (the adapter rejects a missing
 * one via `capabilities.emailRequired` rather than fabricating a placeholder),
 * so it maps straight through; `name` is `string | null`.
 */
export function normalizePaddleCustomer(native: Customer): ProviderCustomer<Customer> {
  return {
    id: native.id,
    email: native.email,
    name: native.name ?? null,
    metadata: paddleCustomDataToMetadata(native.customData),
    createdAt: new Date(native.createdAt),
    raw: native,
  };
}
