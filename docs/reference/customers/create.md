---
title: customers.create
domain: customers
method: create
---

## Description

Create a new normalized customer in the provider's billing system. Callers supply optional `email`, `name`, and `metadata`; the adapter maps these to the provider-native customer create call and returns the resulting normalized [`ProviderCustomer`](../../models/customer.md).

Use this when your application provisions a billing identity for a user — typically right before the first checkout, or as part of a sync job that backfills existing users into a new provider.

Reserved metadata keys (any key starting with `__provider_`) are rejected with a [`MetadataCollisionError`](../../errors/metadata-collision.md) (422) before the provider API is called.

## Request

See [`docs/openapi/customers.json`](../../openapi/customers.json) → operation `customers.create` → `requestBody`.

| Field      | Type                       | Required | Notes                                                    |
| ---------- | -------------------------- | -------- | -------------------------------------------------------- |
| `email`    | `string` (email) \| `null` | no       | Validated as a syntactic email address.                  |
| `name`     | `string` (min 1) \| `null` | no       | Empty strings are rejected.                              |
| `metadata` | `Record<string,string>`    | no       | Reserved keys rejected; otherwise round-tripped to/from. |

## Response

`200` — [`ProviderCustomer`](../../models/customer.md).

## Errors

| Status | Class                       | When                                                                       |
| ------ | --------------------------- | -------------------------------------------------------------------------- |
| 400    | `ProviderValidationError`   | Invalid input shape (bad email syntax, empty name, non-string metadata).   |
| 401    | `ProviderAuthError`         | Provider API key missing or rejected.                                      |
| 422    | `MetadataCollisionError`    | Metadata contained any `__provider_*` key.                                 |
| 429    | `ProviderRateLimitError`    | Provider rate-limited the request.                                         |
| 5xx    | `ProviderUnavailableError`  | Provider returned a 5xx or the transport failed.                           |

## Example

```ts
import { safe } from '@its-just-billing/provider-sdk';
import { createStripeProvider } from '@its-just-billing/provider-stripe';

const provider = createStripeProvider({ apiKey: process.env.STRIPE_SECRET_KEY! });

const customer = await provider.customers.create({
  email: 'jane@example.com',
  name: 'Jane Doe',
  metadata: { internalUserId: 'u_42' },
});

// Or with explicit branching via the `safe()` wrapper:
const result = await safe(() =>
  provider.customers.create({ email: 'jane@example.com' }),
);
if (!result.ok) {
  console.error(result.status, result.error.code, result.error.message);
}
```
