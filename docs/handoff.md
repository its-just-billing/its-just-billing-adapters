---
title: Provider implementation handoff
---

# Provider implementation handoff

A guide for picking up provider adapter work (mock, Stripe, Paddle). Covers the contract you're implementing, the patterns adapters must follow, the helpers available, and how to wire the conformance harness.

Companion docs:
- [`../provider-system-v2.md`](../provider-system-v2.md) — design spec (the contract).
- [`./test-process.md`](./test-process.md) — two-agent pipeline for adding conformance tests.
- [`../README.md`](../README.md) — caller-facing overview.

---

## Repo orientation

```
its-just-billing-adapters/
├── packages/
│   ├── provider-sdk/        ← contract, models, errors, helpers, conformance suite (COMPLETE)
│   ├── provider-mock/       ← in-memory reference adapter (STUB — start here)
│   ├── provider-stripe/     ← Stripe adapter (STUB)
│   └── provider-paddle/     ← Paddle adapter (STUB)
├── docs/
│   ├── handoff.md           ← this file
│   ├── test-process.md      ← two-agent test-generation runbook
│   ├── reference/           ← per-method markdown (stubs, fill in over time)
│   └── openapi/             ← generated from Zod (don't edit)
├── provider-system-v2.md    ← design spec
└── README.md
```

Build / lint / test commands at repo root:

```bash
pnpm -w turbo run build
pnpm -w turbo run test
pnpm --filter @its-just-billing/provider-sdk typecheck
pnpm --filter @its-just-billing/provider-sdk check:conformance-purity
pnpm --filter @its-just-billing/provider-sdk docs:build
```

`pnpm-workspace.yaml` defines all four packages. `turbo.json` orchestrates pipelines.

---

## The contract you're implementing

### Top-level interface

`BillingProvider<TCheckoutPresentation = unknown>` — defined in `packages/provider-sdk/src/billing-provider.ts`:

```ts
interface BillingProvider<TCheckoutPresentation = unknown> {
  readonly providerId: string;
  readonly capabilities: ProviderCapabilities;

  // Required domains
  customers: Customers;
  products: Products;
  prices: Prices;
  subscriptions: Subscriptions;
  checkout: Checkout<TCheckoutPresentation>;
  purchases: Purchases;
  discounts: Discounts;
  events: Events;
  webhooks: Webhooks;

  // Optional domains — presence-based detection
  portal?: Portal;
  billingDocuments?: BillingDocuments;
  paymentMethods?: PaymentMethods;

  // Escape hatch
  raw?: unknown;
}
```

Each adapter exports a narrow type that overrides `raw` and any domains it wants to type:

```ts
// inside provider-stripe
export interface StripeProvider extends BillingProvider<StripeCheckoutPresentation> {
  readonly raw: Stripe;
  subscriptions: Subscriptions<Stripe.Subscription>;
  purchases: Purchases<Stripe.Charge>;
  customers: Customers<Stripe.Customer>;
  // ...override whichever domains you want typed-raw
}
```

### Domains

Required: `customers`, `products`, `prices`, `subscriptions`, `checkout`, `purchases`, `discounts`, `events`, `webhooks`. Optional: `portal`, `billingDocuments`, `paymentMethods` (set the field to populate, omit otherwise — callers detect via `if (provider.portal)`).

Each domain interface is generic on `TRaw = unknown` (and `Checkout` is also generic on `TPresentation`, `Events` on `TPayload`, `Webhooks` on `TEndpointRaw + TEventRaw + TPayload`). Every method returns `Promise<Model<TRaw>>` or `Promise<Page<Model<TRaw>>>` where `Page<T> = { data: T[]; nextCursor: string | null }`.

### Models

Every model lives in `packages/provider-sdk/src/models/`. Each has a Zod schema (for runtime validation + OpenAPI) and a generic TS type derived via `Omit<...,'raw'> & { raw?: TRaw }`:

| Model | Has raw? | Notes |
|---|---|---|
| `ProviderCustomer` | yes | minimal: id, email, name, metadata, createdAt |
| `ProviderProduct` | yes | active is soft-delete flag; taxCategory required |
| `ProviderPrice` | yes | one_time \| recurring discriminated union; quantity first-class |
| `ProviderSubscription` | yes | items, status, pendingChange (for scheduled changes) |
| `ProviderCheckoutSession` | yes + TPresentation | presentation field carries provider bootstrap data |
| `ProviderPurchase` | yes | normalized one-time payment; refunds out of v1 |
| `ProviderDiscount` | yes | benefit (percent/amount) + duration |
| `ProviderEvent` | yes + TPayload | TPayload is the translated domain object |
| `ProviderWebhookEndpoint` | yes | active is send/don't-send toggle, NOT soft-delete |
| `ProviderBillingDocument` | yes | invoice / receipt / credit_note (optional domain) |
| `ProviderPaymentMethod` | yes | non-sensitive card summary (optional domain) |
| `ProviderPortalSession` | yes | self-service portal (optional domain) |

Shared types: `Money` (minor units + lowercase ISO currency), `Metadata` (flat `Record<string,string>`), `Quantity` (`{min, max?}`), `TaxCategory` (enum), `Page<T>`.

### Public helpers — every adapter uses these

In `packages/provider-sdk/src/helpers/`, all re-exported from the package root:

| Helper | Purpose |
|---|---|
| `validate(schema, input, methodLabel)` | Parse a Zod schema; throws `ProviderValidationError(400)` on failure. **Call at the top of every public method.** |
| `safe(fn)` | Wrap a call into `{ ok, status, data \| error }` envelope. For callers, not adapter authors. |
| `paginate(fetchPage)` | Wrap an envelope-returning method into an async iterable. For callers. |
| `assertNoReservedKeys(metadata, methodLabel)` | Throws `MetadataCollisionError(422)` if caller metadata uses any `__provider_*` key. **Call before any provider API call when input has metadata.** |
| `stripReservedKeys(metadata)` | Remove `__provider_*` keys from a record. **Call when normalizing provider output's metadata.** |
| `encodeQuantityToMetadata(quantity)` | Serialize `{min, max?}` into `__provider_quantity_min` / `_max`. |
| `decodeQuantityFromMetadata(metadata, kind)` | Deserialize. Falls back to `{min:1, max:999_999}` for unmanaged (no metadata). |
| `assertQuantityWithinConstraint(value, quantity, methodLabel)` | Throws `ProviderConstraintError(422)` if a value violates the constraint. |
| `defaultQuantityFor(kind)` | Create-time default: recurring → `{min:1, max:1}`, one_time → `{min:1}`. |
| `assertSameCurrency(a, b, methodLabel)` | Throws `ProviderValidationError(400)` on mismatch. |
| `normalizeCurrency(value)` | `.toLowerCase().trim()`. |
| `isProviderError(value)` | Type guard. |

### Error classes — every adapter throws these

In `packages/provider-sdk/src/errors/`. All extend `ProviderError` with `status`, `code`, `message`, optional `cause`, optional `providerCode`, optional `details`:

| Class | Status | Code | When |
|---|---|---|---|
| `ProviderValidationError` | 400 | `validation` | Bad caller input (`validate()` throws this) |
| `ProviderAuthError` | 401/403 | `authentication` / `authorization` | API key missing/rejected |
| `ProviderNotFoundError` | 404 | `not_found` | Throw-on-missing methods (update, cancel, etc.) |
| `ProviderConflictError` | 409 | `conflict` | Duplicate / conflicting state |
| `ProviderConstraintError` | 422 | `constraint` | Provider rejected a valid normalized request |
| `MetadataCollisionError` | 422 | `metadata_collision` | Caller metadata used `__provider_*` key |
| `ProviderUnmanagedStateError` | 422 | `unmanaged_state` | Adapter detected state outside SDK lifecycle |
| `ProviderNotSupportedError` | 422 | `not_supported` | Value outside the adapter's capability set |
| `ProviderRateLimitError` | 429 | `rate_limit` | Provider rate-limited (`retryAfterSeconds` optional) |
| `ProviderNormalizationError` | 502 | `normalization` | Provider response can't be mapped to contract |
| `ProviderUnavailableError` | 5xx | `unavailable` | Provider 5xx or transport failure |
| `WebhookSignatureError` | 400 | `webhook_signature` | Signature verification failed |

---

## Building an adapter — the playbook

### 1. Package skeleton

```
packages/provider-<name>/
├── package.json
├── tsconfig.json
├── tsup.config.ts
└── src/
    ├── index.ts                # public API: createXxxProvider, types
    ├── client.ts               # provider client wrapper / construction
    ├── presentation.ts         # XxxCheckoutPresentation type
    ├── capabilities.ts         # static capability sets
    ├── error-mapping.ts        # provider native → normalized error mapper
    ├── tax-codes.ts            # TaxCategory ⇄ provider-native lookup tables
    ├── ids.ts                  # ID generation (mock) or normalization helpers
    ├── state.ts                # in-memory store (mock only)
    ├── domains/
    │   ├── customers.ts
    │   ├── products.ts
    │   ├── prices.ts
    │   ├── subscriptions.ts
    │   ├── checkout.ts
    │   ├── purchases.ts
    │   ├── discounts.ts
    │   ├── events.ts
    │   └── webhooks.ts
    │   # plus optional: portal.ts, billing-documents.ts, payment-methods.ts
    ├── normalize/              # provider → normalized conversion fns
    │   ├── customer.ts
    │   ├── product.ts
    │   └── ...
    ├── harness.ts              # createXxxHarness for conformance
    └── __tests__/
        └── conformance.spec.ts # describeConformance wiring
```

`package.json` follows the existing stubs (already in place — just fill them in). Key points: depend on `@its-just-billing/provider-sdk` as `workspace:*`, declare the provider's native SDK as a regular dependency, declare vitest in devDependencies.

### 2. The adapter's public type

```ts
// src/presentation.ts
export type StripeCheckoutPresentation =
  | { kind: 'stripe_hosted'; url: string }
  | { kind: 'stripe_embedded'; clientSecret: string };

// src/index.ts
import type Stripe from 'stripe';
import type {
  BillingProvider,
  Customers,
  Products,
  Prices,
  Subscriptions,
  Purchases,
  Discounts,
  Events,
  Webhooks,
} from '@its-just-billing/provider-sdk';

export type { StripeCheckoutPresentation };

/**
 * Narrow provider type. Adapter-aware callers import this for typed raw on
 * the top-level client AND per-response objects.
 */
export interface StripeProvider extends BillingProvider<StripeCheckoutPresentation> {
  readonly raw: Stripe;
  customers: Customers<Stripe.Customer>;
  products: Products<Stripe.Product>;
  prices: Prices<Stripe.Price>;
  subscriptions: Subscriptions<Stripe.Subscription>;
  purchases: Purchases<Stripe.Charge>;
  discounts: Discounts<Stripe.Coupon>;
  events: Events<unknown, Stripe.Event>;
  webhooks: Webhooks<Stripe.WebhookEndpoint, Stripe.Event>;
}

export interface CreateStripeProviderOptions {
  apiKey: string;
  apiVersion?: Stripe.LatestApiVersion;
  // ...
}

export function createStripeProvider(opts: CreateStripeProviderOptions): StripeProvider {
  // construction details
}
```

For mock:

```ts
export interface MockCheckoutPresentation {
  kind: 'mock_hosted';
  url: string;            // e.g. https://mock.invalid/checkout/sess_abc
}

export interface MockProvider extends BillingProvider<MockCheckoutPresentation> {
  readonly raw: MockState;   // expose the in-memory store for tests / inspection
}
```

### 3. The 5-step recipe for every method

Per spec §5, every public method follows this flow:

```ts
async create(input: ProductsCreateInput): Promise<ProductsCreateOutput<Stripe.Product>> {
  // 1. Validate at runtime
  const parsed = validate(ProductsCreateInputSchema, input, 'products.create');

  // 2. Caller metadata check (when input has metadata)
  assertNoReservedKeys(parsed.metadata, 'products.create');

  // 3. Capability check (when normalized value space exceeds provider's)
  if (!capabilities.taxCategories.has(parsed.taxCategory)) {
    throw new ProviderNotSupportedError({
      feature: 'taxCategory',
      value: parsed.taxCategory,
      message: `Stripe does not support taxCategory=${parsed.taxCategory}`,
    });
  }

  // 4. Map to provider-native request
  const stripeInput: Stripe.ProductCreateParams = {
    name: parsed.name,
    description: parsed.description ?? undefined,
    tax_code: TAX_CATEGORY_TO_STRIPE[parsed.taxCategory],
    metadata: parsed.metadata,
  };

  // 5. Call provider, mapping errors
  let native: Stripe.Product;
  try {
    native = await stripe.products.create(stripeInput);
  } catch (err) {
    throw mapStripeError(err, 'products.create');
  }

  // 6. Normalize and return
  return normalizeStripeProduct(native);
}
```

The skeleton is the same on every method: **validate → assert metadata → check capabilities → map input → call → map errors → normalize**.

### 4. Validation — always at the top

```ts
import { validate } from '@its-just-billing/provider-sdk';
import { CustomersCreateInputSchema } from '@its-just-billing/provider-sdk';

async create(input: CustomersCreateInput) {
  const parsed = validate(CustomersCreateInputSchema, input, 'customers.create');
  // parsed is the typed, validated input
}
```

`validate` converts any Zod error into a `ProviderValidationError(400, code: 'validation', issues: [...])`. The adapter never sees Zod errors directly.

The schema is imported from the SDK's per-method schema modules. Every method has an `InputSchema` and `OutputSchema` exported.

### 5. Metadata — the reserved namespace

The SDK reserves keys starting with `__provider_` for adapter-managed state. Caller metadata must never use them; output metadata must never expose them.

```ts
import { assertNoReservedKeys, stripReservedKeys, RESERVED_METADATA_KEYS } from '@its-just-billing/provider-sdk';

// On every input that accepts metadata
assertNoReservedKeys(parsed.metadata, 'products.create');   // throws MetadataCollisionError(422)

// When writing managed state, mix into provider-native metadata
const nativeMetadata = {
  ...parsed.metadata,
  [RESERVED_METADATA_KEYS.QUANTITY_MIN]: '1',
  [RESERVED_METADATA_KEYS.QUANTITY_MAX]: '5',
};

// When normalizing output
const userMetadata = stripReservedKeys(nativeProduct.metadata);
```

Reserved keys currently defined:
- `__provider_quantity_min` / `__provider_quantity_max` — managed quantity constraint
- `__provider_tax_category_raw` — provider-native tax code when normalized maps to `'other'`

### 6. Quantity — managed vs native

Stripe has no native price-level quantity bounds; the adapter encodes `{min, max}` into managed metadata. Paddle has native quantity fields; the adapter reads them directly and doesn't stamp metadata.

**Stripe pattern:**

```ts
import { encodeQuantityToMetadata, decodeQuantityFromMetadata, defaultQuantityFor } from '@its-just-billing/provider-sdk';

// Create — caller omitted quantity, use kind default
async create(input) {
  const parsed = validate(...);
  const quantity = parsed.quantity ?? defaultQuantityFor(parsed.kind);
  const stripeInput = {
    // ...
    metadata: {
      ...parsed.metadata,
      ...encodeQuantityToMetadata(quantity),
    },
  };
  // ...
}

// Read — pull quantity from managed metadata; fall back to UNMANAGED_QUANTITY_DEFAULT if absent
function normalizeStripePrice(native: Stripe.Price): ProviderPrice<Stripe.Price> {
  const kind: PriceKind = native.recurring ? 'recurring' : 'one_time';
  const quantity = decodeQuantityFromMetadata(native.metadata, kind);
  return {
    id: native.id,
    quantity,
    metadata: stripReservedKeys(native.metadata),
    // ...
    raw: native,
  };
}
```

**Paddle pattern:**

```ts
function normalizePaddlePrice(native: PaddlePrice): ProviderPrice<PaddlePrice> {
  // Read directly from Paddle's native quantity fields, NOT from managed metadata
  const quantity: Quantity = {
    min: native.quantity.minimum,
    max: native.quantity.maximum ?? undefined,
  };
  return {
    quantity,
    metadata: stripReservedKeys(native.custom_data ?? {}),
    raw: native,
  };
}
```

The `decodeQuantityFromMetadata` fallback (`{min:1, max:999_999}`) is intentionally permissive — when the SDK reads a Stripe price created outside the SDK with no managed metadata, it must not pre-reject valid quantities.

### 7. Tax category — bidirectional lookup

Every product's normalized `TaxCategory` enum maps to a provider-specific code. Each adapter declares the table:

```ts
// src/tax-codes.ts (Stripe — placeholder codes, verify against Stripe Tax Codes API)
import type { TaxCategory } from '@its-just-billing/provider-sdk';

export const TAX_CATEGORY_TO_STRIPE: Record<TaxCategory, string> = {
  digital_goods: 'txcd_10000000',
  ebooks: 'txcd_10302000',
  implementation_services: 'txcd_20060053',
  professional_services: 'txcd_20030000',
  saas: 'txcd_10103000',
  software_programming_services: 'txcd_20040051',
  standard: 'txcd_10103100',
  training_services: 'txcd_20060047',
  website_hosting: 'txcd_10101001',
};

const STRIPE_TO_TAX_CATEGORY: Record<string, TaxCategory> = Object.fromEntries(
  Object.entries(TAX_CATEGORY_TO_STRIPE).map(([k, v]) => [v, k as TaxCategory]),
);

export function stripeToTaxCategory(code: string | null): TaxCategory | 'other' | null {
  if (code === null) return null;
  return STRIPE_TO_TAX_CATEGORY[code] ?? 'other';
}
```

On normalize, if the provider returned an unmapped code, surface `'other'` and stash the native code in `__provider_tax_category_raw` metadata:

```ts
function normalizeStripeProduct(native: Stripe.Product): ProviderProduct<Stripe.Product> {
  const taxCategory = stripeToTaxCategory(native.tax_code);
  const nativeMetadata = { ...(native.metadata ?? {}) };
  if (taxCategory === 'other' && native.tax_code) {
    nativeMetadata[RESERVED_METADATA_KEYS.TAX_CATEGORY_RAW] = native.tax_code;
  }
  return {
    // ...
    taxCategory,
    metadata: stripReservedKeys(nativeMetadata),
    raw: native,
  };
}
```

### 8. Pagination — cursor translation

Caller sends `{ cursor, limit }`; SDK returns `{ data, nextCursor }`. The cursor is SDK-opaque — adapters translate to/from provider-native pagination:

**Stripe (uses `starting_after` + `has_more`):**

```ts
async list(input?: CustomersListInput): Promise<Page<ProviderCustomer<Stripe.Customer>>> {
  const parsed = input ? validate(CustomersListInputSchema, input, 'customers.list') : undefined;

  const native = await stripe.customers.list({
    starting_after: parsed?.cursor,
    limit: parsed?.limit ?? 100,
    email: parsed?.email,
  });

  const data = native.data.map(normalizeStripeCustomer);
  const nextCursor = native.has_more && data.length > 0
    ? data[data.length - 1]!.id
    : null;

  return { data, nextCursor };
}
```

**Paddle (uses `after` + `meta.pagination.has_more`, with a `next` URL):**

```ts
async list(input) {
  const parsed = input ? validate(...) : undefined;
  const page = await paddle.customers.list({ after: parsed?.cursor, per_page: parsed?.limit });
  const data = page.data.map(normalizePaddleCustomer);
  const nextCursor = page.meta.pagination.has_more
    ? extractAfterToken(page.meta.pagination.next)
    : null;
  return { data, nextCursor };
}
```

The cursor format is the adapter's concern — never expose provider-native pagination shape to callers.

### 9. Capabilities — static per-instance

```ts
// src/capabilities.ts (Stripe)
import type { ProviderCapabilities, TaxCategory } from '@its-just-billing/provider-sdk';

const TAX_CATEGORIES = new Set<TaxCategory>([
  'digital_goods', 'ebooks', 'implementation_services',
  'professional_services', 'saas', 'software_programming_services',
  'standard', 'training_services', 'website_hosting',
]);

// Subset of Stripe's supported currencies — keep this current.
const CURRENCIES = new Set<string>([
  'usd', 'eur', 'gbp', 'jpy', 'cad', 'aud', 'chf', 'cny', 'inr', 'brl',
  // ... (Stripe supports ~135; declare the union you intend to support)
]);

export const STRIPE_CAPABILITIES: ProviderCapabilities = {
  taxCategories: TAX_CATEGORIES,
  currencies: CURRENCIES,
};
```

Construct once at adapter init and reuse:

```ts
const provider: StripeProvider = {
  providerId: 'stripe',
  capabilities: STRIPE_CAPABILITIES,
  // ...
};
```

When a method receives a value outside the capability set, throw `ProviderNotSupportedError(422)` BEFORE calling the provider:

```ts
async create(input) {
  const parsed = validate(...);
  if (!STRIPE_CAPABILITIES.currencies.has(parsed.currency)) {
    throw new ProviderNotSupportedError({
      feature: 'currency',
      value: parsed.currency,
      message: `currency ${parsed.currency} not in Stripe capability set`,
    });
  }
  // ...
}
```

### 10. Error mapping — provider → normalized

Every adapter has one `mapXxxError(err, methodLabel)` that translates provider exceptions into the normalized hierarchy. Pattern:

```ts
// src/error-mapping.ts (Stripe)
import Stripe from 'stripe';
import {
  ProviderAuthError, ProviderConflictError, ProviderConstraintError,
  ProviderNotFoundError, ProviderRateLimitError, ProviderUnavailableError,
  ProviderError,
} from '@its-just-billing/provider-sdk';

export function mapStripeError(err: unknown, methodLabel: string): ProviderError {
  if (!(err instanceof Stripe.errors.StripeError)) {
    return new ProviderError({
      status: 500,
      code: 'unknown',
      message: `${methodLabel}: ${err instanceof Error ? err.message : String(err)}`,
      cause: err,
    });
  }

  const base = {
    cause: err,
    providerCode: err.code,
    message: `${methodLabel}: ${err.message}`,
  };

  switch (err.statusCode) {
    case 400: return new ProviderConstraintError(base);
    case 401: return new ProviderAuthError({ ...base, status: 401 });
    case 403: return new ProviderAuthError({ ...base, status: 403 });
    case 404: return new ProviderNotFoundError(base);
    case 409: return new ProviderConflictError(base);
    case 429:
      return new ProviderRateLimitError({
        ...base,
        retryAfterSeconds: parseRetryAfter(err),
      });
  }

  if (err.statusCode && err.statusCode >= 500) {
    return new ProviderUnavailableError({ ...base, status: err.statusCode });
  }

  return new ProviderError({
    status: err.statusCode ?? 500,
    code: 'unknown',
    ...base,
  });
}
```

For nullable returns (`get`, `archive`, `deactivate`, `activate`), check for provider 404 BEFORE calling `mapError` and resolve `null`:

```ts
async get(input) {
  const parsed = validate(...);
  try {
    const native = await stripe.customers.retrieve(parsed.id);
    if ('deleted' in native && native.deleted) return null;
    return normalizeStripeCustomer(native);
  } catch (err) {
    if (err instanceof Stripe.errors.StripeError && err.statusCode === 404) return null;
    throw mapStripeError(err, 'customers.get');
  }
}
```

### 11. Checkout presentation — per-adapter shape

Pick the shape that matches what callers actually need:

```ts
// Stripe
export type StripeCheckoutPresentation =
  | { kind: 'stripe_hosted'; url: string }
  | { kind: 'stripe_embedded'; clientSecret: string };

async createSession(input) {
  const parsed = validate(...);
  const native = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: parsed.lineItems.map(li => ({ price: li.priceId, quantity: li.quantity })),
    success_url: parsed.successUrl,
    cancel_url: parsed.cancelUrl,
    ui_mode: 'hosted',
  });
  return {
    id: native.id,
    presentation: { kind: 'stripe_hosted', url: native.url! },
    status: normalizeCheckoutStatus(native.status),
    // ...
    raw: native,
  };
}

// Paddle
export type PaddleCheckoutPresentation = {
  kind: 'paddle';
  transactionId: string;
  clientToken: string;
};

// Mock
export interface MockCheckoutPresentation {
  kind: 'mock_hosted';
  url: string;          // e.g. https://mock.invalid/checkout/${id}
}
```

The conformance suite asserts `presentation` is present on every session but doesn't introspect it — adapters own the shape.

### 12. Webhooks — sign / verify / endpoint management

`verify({ payload, signature, secret })` parses a signed payload into a `ProviderEvent`. Each adapter implements its own signature scheme:

- Stripe uses HMAC-SHA256 with `t=<unix-timestamp>,v1=<hex>` header, ~5-minute tolerance.
- Paddle uses HMAC-SHA256 with header `Paddle-Signature: ts=...;h1=...`.
- Mock should match a real scheme (recommend Stripe-style) so verify tests are meaningful.

```ts
import { WebhookSignatureError } from '@its-just-billing/provider-sdk';

async verify(input) {
  const parsed = validate(WebhooksVerifyInputSchema, input, 'webhooks.verify');
  try {
    const native = stripe.webhooks.constructEvent(parsed.payload, parsed.signature, parsed.secret);
    return normalizeStripeEvent(native);
  } catch (err) {
    throw new WebhookSignatureError({
      message: `signature verification failed: ${err instanceof Error ? err.message : 'unknown'}`,
      cause: err,
    });
  }
}
```

Endpoint methods (`createEndpoint`, `updateEndpoint`, `deactivateEndpoint`, etc.) map straight through to the provider's webhook configuration API. `active` on a webhook is a real send/don't-send flag, NOT a soft-delete — `deleteEndpoint` is the hard-delete path.

### 13. Events — filter to normalized enum

`events.list` and `events.get` return only events whose `type` is in `ProviderEventTypeSchema`. The adapter:

1. Fetches the provider's full event stream.
2. Filters to events the SDK normalizes.
3. Maps native types to `ProviderEventType` strings.
4. Drops events with unmappable types (don't surface them).

```ts
import type { ProviderEventType } from '@its-just-billing/provider-sdk';

const STRIPE_TO_NORMALIZED: Record<string, ProviderEventType> = {
  'customer.created': 'customer.created',
  'customer.updated': 'customer.updated',
  'customer.deleted': 'customer.deleted',
  // ...
  'invoice.finalized': 'billing_document.finalized',
};

function maybeMapStripeEvent(native: Stripe.Event): ProviderEvent<unknown, Stripe.Event> | null {
  const normalized = STRIPE_TO_NORMALIZED[native.type];
  if (!normalized) return null;        // silently drop non-normalized events
  return {
    id: native.id,
    type: normalized,
    resource: extractResource(native),
    occurredAt: new Date(native.created * 1000),
    raw: native,
  };
}

async list(input) {
  const parsed = input ? validate(...) : undefined;
  const page = await stripe.events.list({
    starting_after: parsed?.cursor,
    limit: parsed?.limit,
    types: parsed?.types?.flatMap(t => NORMALIZED_TO_STRIPE[t] ?? []),
  });
  const data = page.data.map(maybeMapStripeEvent).filter(Boolean) as ProviderEvent<unknown, Stripe.Event>[];
  return { data, nextCursor };
}
```

For mock, emit events on every write to an in-memory ring buffer; `list` reads from the buffer.

### 14. Unmanaged-state detection

When the adapter reads a resource and finds it can't safely normalize — e.g. a Stripe subscription has a `subscription_schedule` the SDK didn't author — throw `ProviderUnmanagedStateError`:

```ts
import { ProviderUnmanagedStateError } from '@its-just-billing/provider-sdk';

function normalizeStripeSubscription(native: Stripe.Subscription): ProviderSubscription<Stripe.Subscription> {
  if (native.schedule && !isSdkAuthoredSchedule(native.schedule)) {
    throw new ProviderUnmanagedStateError({
      field: 'subscription.schedule',
      expected: 'schedule authored by SDK or absent',
      found: native.schedule,
      message: `Subscription ${native.id} has a non-SDK-authored schedule; raw escape hatch required.`,
    });
  }
  // ... normal normalization
}
```

The contract is "we mark the boundary; callers handle the fallback." Don't try to be clever — fail loud.

---

## Conformance harness wiring

Once your adapter's domains are implemented, wire conformance.

### 1. Build the harness

```ts
// packages/provider-stripe/src/harness.ts
import Stripe from 'stripe';
import type {
  ProviderTestHarness,
} from '@its-just-billing/provider-sdk/conformance';
import { createStripeProvider, type StripeProvider, type StripeCheckoutPresentation } from './index.js';

export function createStripeHarness(): ProviderTestHarness<StripeCheckoutPresentation> {
  const apiKey = process.env.STRIPE_TEST_API_KEY;
  if (!apiKey) throw new Error('STRIPE_TEST_API_KEY required');

  const stripe = new Stripe(apiKey, { apiVersion: '2025-08-27.basil' });
  const provider: StripeProvider = createStripeProvider({ apiKey });

  return {
    label: 'stripe',
    provider,

    // Self-setup: Stripe can create subscriptions and complete checkouts via API
    setup: {
      async createSubscription({ customerId, priceId, quantity = 1 }) {
        const native = await stripe.subscriptions.create({
          customer: customerId,
          items: [{ price: priceId, quantity }],
          payment_behavior: 'default_incomplete',
          // ... use test mode payment method
        });
        return normalizeStripeSubscription(native);
      },
      async completePurchase({ checkoutSessionId }) {
        // Stripe doesn't directly "complete" a checkout via API; use test helpers
        // or pre-paid mode. Defer to the actual Stripe testing playbook.
        throw new Error('TODO: implement Stripe completePurchase via test mode');
      },
    },

    // Fixtures: read from env vars
    fixtures: {
      customerId: process.env.STRIPE_FIXTURE_CUSTOMER_ID,
      productId: process.env.STRIPE_FIXTURE_PRODUCT_ID,
      recurringPriceId: process.env.STRIPE_FIXTURE_RECURRING_PRICE_ID,
      oneTimePriceId: process.env.STRIPE_FIXTURE_ONE_TIME_PRICE_ID,
      subscriptionId: process.env.STRIPE_FIXTURE_SUBSCRIPTION_ID,
      discountId: process.env.STRIPE_FIXTURE_DISCOUNT_ID,
      webhookEndpointId: process.env.STRIPE_FIXTURE_WEBHOOK_ENDPOINT_ID,
    },

    // Independent verification via native SDK
    assertConsistency: {
      async customer(output) {
        const native = await stripe.customers.retrieve(output.id);
        if ('deleted' in native && native.deleted) throw new Error(`consistency: customer ${output.id} is deleted natively`);
        if (native.email !== output.email) throw new Error(`consistency: email mismatch`);
        if (native.name !== output.name) throw new Error(`consistency: name mismatch`);
      },
      async product(output) {
        const native = await stripe.products.retrieve(output.id);
        if (native.active !== output.active) throw new Error(`consistency: active mismatch`);
        if (native.name !== output.name) throw new Error(`consistency: name mismatch`);
      },
      async subscription(output) {
        const native = await stripe.subscriptions.retrieve(output.id);
        if (native.status !== output.status) throw new Error(`consistency: status ${output.status} vs ${native.status}`);
        if (native.cancel_at_period_end !== output.cancelAtPeriodEnd) {
          throw new Error(`consistency: cancelAtPeriodEnd mismatch`);
        }
        if (native.items.data.length !== output.items.length) {
          throw new Error(`consistency: item count mismatch`);
        }
      },
      // ... per-model verifiers
    },

    async teardown() {
      // Cleanup any state the test created that doesn't auto-clean
    },
  };
}
```

### 2. Wire the conformance spec

```ts
// packages/provider-stripe/src/__tests__/conformance.spec.ts
import { describeConformance } from '@its-just-billing/provider-sdk/conformance';
import { createStripeHarness } from '../harness.js';

describeConformance('stripe', () => createStripeHarness(), {
  suites: ['automated', 'self-setup', 'fixture'],
});
```

For semi-manual: separate spec file gated on `INTERACTIVE`:

```ts
// packages/provider-stripe/src/__tests__/conformance.interactive.spec.ts
import { describeConformance } from '@its-just-billing/provider-sdk/conformance';
import { createStripeHarness, withPromptCapability } from '../harness.js';

describeConformance('stripe', () => withPromptCapability(createStripeHarness()), {
  suites: ['semi-manual'],
});
```

### 3. Adapter-side native tests (optional)

Conformance covers the cross-provider contract + the `assertConsistency` independent verification. For provider-specific behaviors outside the normalized contract (webhook emission timing, async settlement, Stripe Tax computation, Paddle Retain), the adapter package adds its own native tests under `src/__tests__/`. These can import the adapter freely.

---

## Conformance suite map

What's currently populated (none of it runs yet — no adapter exists):

| Suite | Domains | Notes |
|---|---|---|
| **automated** | customers, products, prices, discounts, subscriptions (validation only), checkout, purchases (validation + empty-state), events, webhooks, capabilities | Optional domains (portal, billing-documents, payment-methods) not yet generated. |
| **self-setup** | subscriptions, purchases | Gated on `harness.setup.createSubscription` / `completePurchase`. |
| **semi-manual** | purchases | Gated on `INTERACTIVE=1` + `harness.prompt`. |
| **fixture** | customers, products, prices, discounts, subscriptions, webhooks | Gated on the relevant `harness.fixtures.<id>`. 6 domains, ~28 scenarios, ~1,938 LOC. |

Every conformance test calls `await harness.assertConsistency?.<model>?.(result)` after every write. Mock harnesses typically don't supply these. Stripe/Paddle harnesses should implement every applicable verifier.

---

## Patterns and pitfalls

### Lazy skip-gating with `lazySkipIf`

Self-setup and fixture suites populate `harness` inside `beforeAll`, then gate
individual tests on what the harness exposes. **Do not use `it.skipIf(...)`**:
vitest evaluates the predicate at *register* time (when the describe body
runs), but `harness` is still uninitialized then, so every gated test would
skip unconditionally.

The SDK exposes two helpers in `@its-just-billing/provider-sdk/conformance`
(see `src/conformance/skip-if.ts`) for this pattern:

- `lazySkipIf(() => predicate)(name, fn, timeout?)` — same shape as
  `it.skipIf(predicate)(name, fn)`, but re-evaluates the predicate inside
  the test body so it observes the populated harness. Forwards vitest's
  optional `timeout` argument.
- `requireFixture(value, label)` / `nonNull(value, label)` — narrow
  `T | null | undefined` to `T` with a labeled throw, so fixture id reads
  and post-`healthCheck` snapshots avoid `noNonNullAssertion` lint errors.

```ts
import { lazySkipIf, requireFixture, nonNull } from '@its-just-billing/provider-sdk/conformance';

describe(`subscriptions [fixture] [${label}]`, () => {
  let harness!: ProviderTestHarness;
  let provider!: BillingProvider;
  beforeAll(async () => {
    harness = await Promise.resolve(factory());
    provider = harness.provider;
  });

  lazySkipIf(() => !harness?.fixtures?.subscriptionId)(
    'scenario name',
    async () => {
      const id = requireFixture(harness.fixtures?.subscriptionId, 'subscriptionId');
      // ... test body — `id` is typed as string, no `!` needed
    },
  );
});
```

`let harness!:` (the **definite-assignment assertion**) remains the right
declaration shape: it tells TS that the value will be set before any read,
which is true because all reads happen inside the test body (run-time) while
the assignment happens in `beforeAll` (also run-time, just earlier).

### Conformance purity guard

`packages/provider-sdk/scripts/check-conformance-purity.ts` greps every file under `src/conformance/` for imports of `@its-just-billing/provider-mock`, `provider-stripe`, or `provider-paddle`. Any match fails CI. Run after every conformance edit.

### `Page<T>` envelope

List methods return `{ data: T[]; nextCursor: string | null }`. Forward-only cursor; callers maintain a stack for back-navigation. The `paginate()` helper wraps an envelope-returning method into an `AsyncIterable<T>`.

### Typed raw narrowing

`raw?: TRaw` is on every model. Domain interfaces are generic on TRaw with default `unknown`. Adapter narrows per-domain via interface extension. Adapter-agnostic code stays untyped.

### Checkout's two generics

`Checkout<TPresentation, TRaw>` — only domain with two. Adapter declares both:

```ts
checkout: Checkout<StripeCheckoutPresentation, Stripe.Checkout.Session>;
```

### Soft-delete vs hard-delete

- Products / prices / discounts have `active: boolean` as soft-delete. Use `deactivate()` / `activate()` not `update({ active })`. Update inputs don't accept `active`.
- Customers have `archive()` (no active field; deletion semantics vary by provider).
- Webhook endpoints have `active` as a real send/don't-send toggle (mutable via `update`, `activate`, `deactivate`); plus `deleteEndpoint()` is the hard-delete.

### Validation lives at the automated tier

Validation cases (`ProviderValidationError(400)`, `MetadataCollisionError(422)`, etc.) only need to live in the **automated** suite. They throw before any provider call, so they don't need a real provider. **Do not** duplicate them in self-setup / semi-manual / fixture.

### Capabilities surface

`provider.capabilities.taxCategories: ReadonlySet<TaxCategory>` and `currencies: ReadonlySet<string>`. Pre-flight checks. Adding a new axis is a contract change — go through the spec.

### `__provider_*` reserved keys

Always reject on input via `assertNoReservedKeys`. Always strip on output via `stripReservedKeys`. Use for adapter-managed state (quantity, tax category raw, future additions). New reserved keys are a contract change.

### Unmanaged state vs not-supported

- `ProviderUnmanagedStateError(422, 'unmanaged_state')` — adapter detected state created outside SDK lifecycle that the contract can't safely express.
- `ProviderNotSupportedError(422, 'not_supported')` — caller passed a structurally-valid value the provider can't honor (out of capability set).

Both are 422 but they're different semantics. Pick the right one.

---

## What's next — concrete TODOs

In priority order:

1. **Mock provider** (`packages/provider-mock`):
   - [ ] `src/state.ts` — in-memory Maps for each resource type.
   - [ ] `src/ids.ts` — deterministic ID generator (`cus_mock_xxx`, etc.).
   - [ ] `src/presentation.ts` — `MockCheckoutPresentation`.
   - [ ] `src/capabilities.ts` — all 9 tax categories, ~30 common currencies.
   - [ ] `src/error-mapping.ts` — mock-specific (in-memory, mostly just throws SDK errors directly).
   - [ ] `src/domains/*.ts` — each domain implementation.
   - [ ] `src/index.ts` — `createMockProvider()` + `MockProvider` type.
   - [ ] `src/harness.ts` — `createMockHarness()`, full `setup.*` (mock can self-create anything).
   - [ ] `src/__tests__/conformance.spec.ts` — register automated + self-setup + fixture suites.
   - [ ] Verify all four suites pass.

2. **Stripe provider** (`packages/provider-stripe`):
   - [ ] Same skeleton as mock.
   - [ ] Provider-native error mapping for `Stripe.errors.*`.
   - [ ] Tax category lookup tables.
   - [ ] Capabilities sets (all 9 categories + Stripe's currency list).
   - [ ] Implement domains using `stripe-node` SDK.
   - [ ] `harness.setup.createSubscription` via Stripe API.
   - [ ] `harness.assertConsistency.*` via direct `stripe.*.retrieve(id)` calls.
   - [ ] Conformance spec wiring with env-var fixtures.
   - [ ] Document required env vars in README or harness JSDoc.

3. **Paddle provider** (`packages/provider-paddle`):
   - [ ] Same skeleton.
   - [ ] Paddle is digital-only; capability set excludes physical-only categories if any (current normalized enum is all-digital, so all 9 stay).
   - [ ] `harness.setup.createSubscription` likely impossible — most subscription tests gate to fixture or semi-manual.
   - [ ] Webhook signature verification using Paddle's `ts;h1=` scheme.
   - [ ] Conformance spec wiring.

4. **Tighten conformance** — iterate until all three adapters produce identical normalized shapes (modulo provider ID formats). Surface any contract ambiguities and update the spec.

### Starter checklist for the mock adapter

```bash
# Get the SDK building locally
pnpm -w turbo run build
pnpm --filter @its-just-billing/provider-sdk typecheck

# Open the package
cd packages/provider-mock

# Build the skeleton (use the playbook §1)
# Implement domains one at a time (customers first — simplest)
# Wire conformance: src/__tests__/conformance.spec.ts

# Run the suite
pnpm test
```

The mock's success criterion: **every test in the conformance suite either passes or skips cleanly** when run against the mock harness with all four suites enabled. That proves the conformance suite is correctly wired and the contract is implementable.

---

## Reference

- Spec: [`../provider-system-v2.md`](../provider-system-v2.md)
- Two-agent test pipeline: [`./test-process.md`](./test-process.md)
- README (caller-facing): [`../README.md`](../README.md)
- Harness types: `packages/provider-sdk/src/conformance/harness.ts`
- Fixture runner: `packages/provider-sdk/src/conformance/fixture-runner.ts`
- Purity guard: `packages/provider-sdk/scripts/check-conformance-purity.ts`
- Public exports: `packages/provider-sdk/src/index.ts`
- Conformance public exports: `packages/provider-sdk/src/conformance/index.ts`
