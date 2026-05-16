---
title: Provider implementation handoff
---

# Provider implementation handoff

A guide for picking up provider adapter work (mock, Stripe, Paddle/Polar). Covers the contract you're implementing, the patterns adapters must follow, the helpers available, and how to wire the conformance harness.

**Current state** (as of this handoff): SDK + mock + Stripe are all complete. Stripe runs ~900 tests green against a live test-mode account (7 skip cleanly when Stripe doesn't expose the necessary admin path). The `purchases`→`payments` rename and discounts-on-payments are resolved. **The second real provider is now Paddle, not Polar.** That reopens the trials decision: Paddle has price-level trials, which the original checkout-only resolution explicitly said would force a rev. Decision #2 has been **re-resolved** as a dual capability-axis model (price-level + checkout-level trials) — see [§Open SDK contract decisions](#open-sdk-contract-decisions) decision #2. Resource ownership (decision #3) is **resolved as the ownership boundary**: the SDK normalizes only resources it owns; foreign/drifted products & prices fail loud (`ProviderUnmanagedStateError`) instead of being normalized-and-pretended; `import` is the sole adoption path. Enforced from the first provider. Read [§Closable vs unclosable invariants](#closable-vs-unclosable-invariants) before finalizing any domain for a new provider.

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
│   ├── provider-mock/       ← in-memory reference adapter (COMPLETE — read first)
│   ├── provider-stripe/     ← Stripe adapter (COMPLETE — live test runs green)
│   └── provider-paddle/     ← Paddle adapter (STUB, possibly to be replaced by Polar)
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
  payments: Payments;
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
  payments: Payments<Stripe.Charge>;
  customers: Customers<Stripe.Customer>;
  // ...override whichever domains you want typed-raw
}
```

### Domains

Required: `customers`, `products`, `prices`, `subscriptions`, `checkout`, `payments`, `discounts`, `events`, `webhooks`. Optional: `portal`, `billingDocuments`, `paymentMethods` (set the field to populate, omit otherwise — callers detect via `if (provider.portal)`).

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
| `ProviderPayment` | yes | normalized money-movement record (one-time charge, subscription renewal, etc.); refunds out of v1 |
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
    │   ├── payments.ts
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
  Payments,
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
  payments: Payments<Stripe.Charge>;
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
      async completePayment({ checkoutSessionId }) {
        // Stripe doesn't directly "complete" a checkout via API; use test helpers
        // or pre-paid mode. Defer to the actual Stripe testing playbook.
        throw new Error('TODO: implement Stripe completePayment via test mode');
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
| **automated** | customers, products, prices, discounts, subscriptions (validation only), checkout, payments (validation + empty-state), events, webhooks, capabilities | Optional domains (portal, billing-documents, payment-methods) not yet generated. |
| **self-setup** | subscriptions, payments | Gated on `harness.setup.createSubscription` / `completePayment`. |
| **semi-manual** | payments | Gated on `INTERACTIVE=1` + `harness.prompt`. |
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

`provider.capabilities.taxCategories: ReadonlySet<TaxCategory>`, `currencies: ReadonlySet<string>`, and `webhookEventTypes: ReadonlySet<ProviderEventType>`. Pre-flight checks. `webhookEventTypes` declares which normalized event types the provider can actually emit; `webhooks.createEndpoint`/`updateEndpoint` reject subscriptions to types outside this set with `ProviderNotSupportedError(422)`. Adding a new axis is a contract change — go through the spec.

### `__provider_*` reserved keys

Always reject on input via `assertNoReservedKeys`. Always strip on output via `stripReservedKeys`. Use for adapter-managed state (quantity, tax category raw, future additions). New reserved keys are a contract change.

### Unmanaged state vs not-supported

- `ProviderUnmanagedStateError(422, 'unmanaged_state')` — adapter detected state created outside SDK lifecycle that the contract can't safely express.
- `ProviderNotSupportedError(422, 'not_supported')` — caller passed a structurally-valid value the provider can't honor (out of capability set).

Both are 422 but they're different semantics. Pick the right one.

---

## What's next — concrete TODOs

In priority order:

1. **Open SDK contract decisions** — rename and discount-on-payments are ✅ RESOLVED. Trials (decision #2) are ✅ **RE-RESOLVED** as a dual capability-axis model (price-level + checkout-level), reopened because the second provider is now Paddle (price-level trials). Resource ownership (decision #3) is ✅ **RESOLVED** as the ownership boundary — owned-only normalization, fail-loud on foreign/drifted products & prices, `import` as the sole adoption path, enforced from the first provider. Retrospective + rationale in [§Open SDK contract decisions](#open-sdk-contract-decisions); the governing principle is [§Closable vs unclosable invariants](#closable-vs-unclosable-invariants).

2. **Mock provider** (`packages/provider-mock`) — ✅ **DONE.** Reference implementation. 921 tests green. Read `packages/provider-mock/src/` end-to-end before starting any new adapter — every pattern you'll need is already there.

3. **Stripe provider** (`packages/provider-stripe`) — ✅ **DONE.** Live test mode runs 890 pass / 6 skip / 0 fail. See the [Stripe playbook](#stripe-playbook) for the patterns the adapter ended up using, and [§Stripe quirks & lessons](#stripe-quirks--lessons) for what came out of the live test runs that the original playbook didn't anticipate.

4. **Second real provider — Paddle** — uses the existing `packages/provider-paddle/` skeleton. Paddle has **native price-level trials** and **no checkout-level trial**: declare `trial.priceLevel: true`, `trial.checkoutLevel: false`, map Paddle's native trial fields to the price model's `TrialSpec`, and reject a checkout-level `trial` with `ProviderNotSupportedError(422)`. Before finalizing `products`/`prices`/`checkout`, run the required+immutable audit in [§Closable vs unclosable invariants](#closable-vs-unclosable-invariants) per domain. Polar (if ever taken on) reuses the same trial flags and gets its own future product-level-price-model flag — the shape landing now is forward-compatible and needs no rev for that.

   Whichever provider lands second:
   - Same domain skeleton + 5-step recipe per method.
   - Webhook signature verification using the provider's native scheme.
   - `harness.setup.createSubscription` — only implement if the provider can self-create subs without manual checkout. Paddle's likely can't; Polar's API is friendlier here.
   - Conformance spec wiring (automated / self-setup / fixture) — same three-file pattern as Stripe.
   - Implement the `cleanupResource` hook on the harness for hard-delete (see Stripe's `harness.ts` — products, discounts, customers each have provider-native delete paths the SDK contract intentionally doesn't expose, but tests need them).

5. **Close conformance gaps** — three are known:
   - **Semi-manual payments suite** does not track the customer/product/price/payment it creates; they orphan after every run. The `cleanupResource` hook exists; the semi-manual suite needs the same `track(id)` + `afterAll` cleanup loop as the automated suites.
   - **Self-setup subscriptions** track customers but not the subscriptions themselves. The `'subscription'` kind is already in `ProviderTrackedKind` — wire it.
   - **Manual-flow resource discovery** (Paddle-style): there's no current way for a semi-manual test to record an id that materialized post-checkout. May need an explicit "I observed this id after a manual step" track API.

---

## Closable vs unclosable invariants

The governing principle for the whole contract. Read this before finalizing any domain for a new provider.

**The SDK's purpose is not exact normalization. It is exact normalization wherever possible, and explicit, declared invariant handling everywhere else.** Where a provider diverges, the contract declares the divergence via a capability flag rather than papering it over silently.

**Divergence is closed by one of two mechanisms.**

1. **Capability flags — for optional/behavioral divergence** (trials, currencies, tax categories). The consumer reads the flag, learns "not here," and routes around it.
2. **The ownership boundary — for structural invariants over a resource** (a product owns exactly one price model; an SDK-authored subscription schedule). You cannot capability-flag your way out of "this foreign resource silently violates an invariant we promised." You close it by **only normalizing resources the SDK owns**, and failing loud on everything else.

The strict shape is always *modelable* — **Polar proves this**: Polar runs on Stripe and presents exactly the product/price model we'd otherwise struggle to normalize. It succeeds not because it has a database but because it is the **exclusive mutation path** for the Stripe resources it manages — it creates them to fit its model and never tries to normalize an arbitrary foreign Stripe product. The only thing we can never prove is *that an arbitrary out-of-band resource fits the model* (it has none of our metadata; one field conflicting is as likely as not). So the honest contract admits only owned resources.

Persistence substrate does not change any of this — metadata and a local DB are isomorphic in expressiveness; anything enforceable with persistent state is enforceable with `__provider_*` metadata, just slower. A local DB only makes the *same* contract cheaper to serve; it does not extend what can be normalized. Enforcement of any cross-resource invariant is gated by **mutation-path exclusivity** (you created or imported+adopted the resource and nothing mutates it out-of-band), never by where the ownership claim is stored. A higher-level package can close otherwise-open invariants **iff it owns CRUD on the resources**, under the explicit usage rule: *edit a managed resource out-of-band → your fault.*

**The ownership boundary, concretely.** Stamp an ownership marker in `__provider_*` metadata at every `*.create`. Re-check ownership on every normalize (the `isSdkAuthoredSchedule` / playbook §14 precedent — a one-time stamp is not trusted; the invariant is re-derived each read). A resource that is unowned, or owned-but-drifted, encountered where the contract requires a structural guarantee → `ProviderUnmanagedStateError`; never normalize-and-pretend. `import` (per-domain, may land incrementally) is the **sole sanctioned adoption path**: read native → validate against the structural invariants → iff compatible, stamp ownership → first-class SDK resource; incompatible → `ProviderConstraintError`/`ProviderUnmanagedStateError` at import time. This posture is enforced from the **first** provider so no adapter ever ships a "normalize anything" surface that has to be clawed back. Scope: it applies only to domains carrying such an invariant (products/prices, subscription schedules). Domains with no cross-resource invariant (customers, payments, events, webhooks) still normalize foreign resources freely — normalization there is a pure function of one response, nothing to break — preserving "exact normalization wherever possible."

**Exactly one case is unclosable: a required normalized field that some provider makes default-forced and immutable.** If our contract requires a field, the provider won't let it be set at create (so we must inject a default), and the provider also won't let it be changed via `update`, then the default is permanent. The field looks like a consumer affordance but is frozen — a worse lie than declaring "not supported," because the consumer believes they have control they don't.

**Per-field audit — run this for every required field, per provider, before finalizing a domain.** Classify the field as one of:

| Class | Verdict |
|---|---|
| create-settable **and** update-mutable | ✅ fine |
| create-settable, immutable-by-domain (e.g. `createdAt`) | ✅ fine — no consumer ever needs to change it |
| **default-forced and immutable** | ⛔ toxic — the default silently becomes the only value |

A field in the toxic bucket must be **demoted to capability-gated or dropped from required** — never patched with a silent default. Optional fields are never toxic (absence is itself a declaration).

For the initial providers (Stripe, Paddle) the goal is **zero toxic invariants**: behavioral divergence closed by capability flags, structural invariants closed by the ownership boundary. Decision #3 is **resolved** as the ownership boundary above (not deferred — a "normalize anything" products/prices surface would break the moment a foreign product with a conflicting field is read).

---

## Open SDK contract decisions

These touch the public contract, so the cost of changing them grows with each adapter that ships. Governed by [§Closable vs unclosable invariants](#closable-vs-unclosable-invariants).

### 1. Discounts on payments — ✅ RESOLVED

**Rename `purchases` → `payments`:** done. **Discount surface on payments + checkout sessions:** done.

The new shape that landed:

- New shared model `AppliedDiscount` in `packages/provider-sdk/src/models/applied-discount.ts`:
  ```ts
  AppliedDiscount = {
    discountId: string;          // PromotionCode id; refetchable via discounts.get
    code: string | null;         // public-facing code if any
    amountDiscounted: Money;     // currency matches the carrier's amount
  }
  ```
- `ProviderPayment` gained `subtotal?: Money` and `appliedDiscounts: AppliedDiscount[]`.
- `ProviderCheckoutSession` gained `appliedDiscounts: AppliedDiscount[]`.

Adapter notes:

- **Mock** computes `appliedDiscounts` synchronously at checkout-session create (percent: `floor(subtotal × percentOff / 100)`; amount: `min(amountOff, subtotal)` with currency check). `admin.completePayment` threads the session's `appliedDiscounts` into the resulting payment and clamps final `amount` to `>= 0`.
- **Stripe checkout sessions** surface `total_details.breakdown.discounts[]`, but only after a session has been processed — for sessions still in `'open'` status Stripe returns no entries. The contract treats this as conformant; consumers re-read the session after completion to observe the resolved discount.
- **Stripe payments** fetch the associated `Invoice` (expanded with `discounts`) when `charge.invoice` is set, then map `invoice.total_discount_amounts[]` to `appliedDiscounts[]` and use `invoice.subtotal_excluding_tax` for `subtotal`. PaymentIntent-only charges (no invoice) leave `appliedDiscounts: []` and omit `subtotal` — Stripe's Charge object alone doesn't carry discount info. Future work: walk back through the originating CheckoutSession to recover it.
- **Coupon-only discounts** (Stripe discounts created via the `coupon` parameter without a PromotionCode) are intentionally invisible in `appliedDiscounts` — the SDK identifies discounts by PromotionCode id, and coupon-only entries aren't refetchable via `discounts.get`. Same rule the event normalizer applies.

**Discounts on subscriptions:** still **no**. The `priceId` describes the recurring obligation; per-period payment events carry the money-changed-hands truth.

### 2. Trials — ✅ RE-RESOLVED (dual capability axis)

**History.** Originally resolved as checkout-time-only (Stripe/Polar model), with the explicit caveat: "if a price-attached-trial provider becomes a hard requirement later, the contract will need to rev." The second provider is now **Paddle**, which has native price-level trials and no checkout-level trial. That is exactly the trigger. Decision re-opened and re-resolved as below. The originally-landed shape (`TrialSpec`, checkout-level `trial?`, `trialEnd`, the two trial events) is **unchanged**; the new model is purely additive on top of it.

**The re-resolution: two orthogonal capability axes, not one model choice.**

- `trial.checkoutLevel: boolean` — a `TrialSpec` may be passed to `checkout.createSession`.
- `trial.priceLevel: boolean` — a `TrialSpec` may be attached to a price (new optional `trial?: TrialSpec` field on the price model).

| Provider | `trial.checkoutLevel` | `trial.priceLevel` |
|---|---|---|
| Stripe | `true` (native) | `true` — emulated: `TrialSpec` stamped in price metadata, read at session create, translated to `trial_period_days` (day/week units only; month/year still `ProviderNotSupportedError`, same constraint as checkout-level) |
| Paddle | `false` — reject a checkout-level `trial` with `ProviderNotSupportedError(422)` | `true` (native — map Paddle's native trial fields to the price `TrialSpec`) |
| Polar (future) | `true` | TBD — both covered by these flags, no further rev |

A provider rejects the unsupported axis with `ProviderNotSupportedError(422)` before calling the provider, same as any other capability miss. The price-level `trial?` field is **optional**, so it is never a toxic invariant per [§Closable vs unclosable invariants](#closable-vs-unclosable-invariants) — absence on a checkout-only provider is itself the declaration.

**Contract delta to land:** add optional `trial?: TrialSpec` to the price model + its schema; add `trial: { checkoutLevel: boolean; priceLevel: boolean }` to `ProviderCapabilities`; keep everything from the original resolution below.

The shape from the original resolution (still in force):

- New shared `TrialSpec` model at `packages/provider-sdk/src/models/trial.ts`:
  ```ts
  TrialSpec = { count: number; unit: 'day' | 'week' | 'month' | 'year' }
  ```
  Reuses `RecurringIntervalSchema` so the unit enum is shared with recurring-price intervals.
- `checkout.createSession` accepts optional `trial?: TrialSpec`. Adapters reject `trial` on all-one-time carts with `ProviderConstraintError` (semantically incoherent).
- `ProviderSubscription` gained `trialEnd: Date | null`. Non-null whenever a trial was ever set (Stripe's `trial_end` persists past the actual trial end; the contract treats `trialEnd` as "when the trial concluded or will conclude").
- `ProviderEventTypeSchema` gained `'subscription.trial_will_end'` and `'subscription.trial_ended'`.
- `ProviderTestHarness.setup.createSubscription` accepts an optional `trial?: TrialSpec`.

Adapter notes:

- **Mock** honors all four units via calendar math (`UTC` arithmetic for day/week, `setUTCMonth`/`setUTCFullYear` for month/year). `MockAdmin` exposes `endTrial` and `warnTrialEnding` as test affordances for emitting the two new events.
- **Stripe checkout** translates `{count, unit:'day'}` to `trial_period_days = count`, `{count, unit:'week'}` to `count × 7`. `month`/`year` units raise `ProviderNotSupportedError` (Stripe has no fixed-day equivalent). Stripe rejects `trial_period_days > 730`; the adapter pre-flights as `ProviderConstraintError`.
- **Stripe events**: `customer.subscription.trial_will_end` maps to `subscription.trial_will_end` 1:1. `subscription.trial_ended` has no native Stripe event — the normalizer does NOT synthesize one. Consumers wanting trial-ended detection on Stripe diff `status` across `customer.subscription.updated` events themselves. The `subscription.trial_ended` enum value stays in `ProviderEventTypeSchema` for providers (Polar) that emit it natively; Stripe's `webhookEventTypes` capability excludes it so `webhooks.createEndpoint` rejects subscriptions to it with `ProviderNotSupportedError(422)`.
- **Stripe subscription normalizer** surfaces `trial_end` as `trialEnd` (null when absent).

**Trial capability axis on `ProviderCapabilities`?** No. The capability check is enforced at the unit-translation step in the Stripe adapter (`month`/`year` → `ProviderNotSupportedError`), not via a static `ProviderCapabilities` field. Adding a separate axis would duplicate information that's already implicit in the error path.

### 3. Resource ownership / managed-resource model — ✅ RESOLVED (ownership boundary)

**Resolution: the ownership boundary**, specified in [§Closable vs unclosable invariants](#closable-vs-unclosable-invariants). The SDK normalizes only resources it owns (created, or imported+validated+stamped). Unowned or drifted resources where a structural invariant is required → `ProviderUnmanagedStateError`, never normalized-and-pretended. `import` is the sole sanctioned adoption path for an existing catalog; incompatible resources are rejected at import. Enforced from the first provider; the per-domain `import` primitive may land incrementally but the posture does not.

**Why resolved now, not deferred** (an earlier draft deferred this — wrong): a "normalize anything" products/prices surface breaks the first time a foreign product with one conflicting field is read. The risk is unavoidable, not hypothetical. Polar demonstrates the model is sound *and* that the answer is ownership: it is Stripe underneath, presents this exact strict model successfully, and does so purely by being the exclusive mutation path for resources it creates — never by normalizing arbitrary foreign Stripe products. We can model the shape; we cannot guarantee a foreign resource fits it; therefore admit only owned resources.

**Still future / out of scope here:** if **Polar** is taken on, its product-level price model gets its own capability flag (e.g. `productPriceModel: 'product-owned' | 'price-owned'`) with a capability-conditional `products`/`prices` contract. The Stripe/Paddle shape landing now is forward-compatible with that flag — no rev required. A higher-level CRUD-owning package can close further invariants under *edit out-of-band → your fault*, but adds no normalization power the ownership boundary doesn't already give (metadata ≡ DB in expressiveness).

The original problem write-up is retained below for implementation detail.

**Problem.** Providers disagree about where invariants live, and the SDK can only *enforce* a normalized invariant on resources it created or controls.

Concrete trigger: **Stripe lets one product carry prices of different types** — a one-time price and a recurring price on the same `product`. **Polar fixes the price model at the product level** — a product is recurring *or* one-time, not both. To offer a uniform contract (candidate invariant: *"a product owns whether it is recurring or one-time"*) the SDK would need to enforce on Stripe what Polar enforces natively. We *can* enforce it on Stripe via managed metadata + create/update checks (stamp `__provider_product_price_model` on `products.create`; reject a `prices.create` whose `kind` disagrees). But:

- A product that **already exists**, or one **created natively on the provider** (Stripe dashboard, Stripe API directly), has no marker — we can't retroactively enforce the invariant on it.
- A product created/stamped by us but later **mutated natively** can drift out of the invariant behind our back.

**This is a recurring theme, not a one-off.** The SDK can already support a wider class of normalized features *only* on resources it stamped:

- **Quantity bounds** — Stripe has no native price-level quantity; the SDK manages `{min,max}` in `__provider_quantity_*`. A natively-created price has no bounds and falls back to the permissive `UNMANAGED_QUANTITY_DEFAULT`.
- **SDK-authored subscription schedules** — `isSdkAuthoredSchedule` checks `__provider_sdk_schedule` on every normalize; a non-SDK-authored schedule throws `ProviderUnmanagedStateError` (see playbook §14).
- **Tax-category-raw stash** (`__provider_tax_category_raw`), **anonymous discount-code marker**, **restrictedTo metadata stash** — all the same shape: the SDK reasons safely only about state it wrote.

The product-price-model case is just the first one where the divergence forces a *structural* invariant (not a per-field annotation), which is why it's worth formalizing the pattern now rather than adding a fifth ad-hoc marker.

**Two candidate designs:**

**(A) SDK-owned-only.** Stamp an ownership marker (e.g. `__provider_owned: '1'`) on every `*.create`. Reads of an unmarked resource surface `ProviderUnmanagedStateError`. Strictest and simplest to reason about, but rejects every pre-existing / natively-created resource outright — a hard sell for real users who already have a Stripe catalog.

**(B) Explicit `import` per resource.** Add an `import` method per domain (`products.import({ id })`, etc.) that (1) reads the native resource, (2) validates it against the SDK's structural invariants, (3) **iff compatible**, stamps the ownership/managed metadata so it becomes a first-class SDK resource. Incompatible resources are rejected at import with a clear error (e.g. a Stripe product with mixed price models → `ProviderConstraintError`/`ProviderUnmanagedStateError`). Native resources are otherwise invisible to the normalized surface until imported.

**Open question the design must answer — post-import drift.** Import validates *at import time*. If we import a product (validated single-price-model), then a consumer makes a native change (adds a recurring price to a one-time product), a previously-legit SDK-owned product is now botched. An ownership marker is a *claim stamped once*, not a continuously-enforced guarantee. The contract has to pick one of:

- **Re-validate on every read.** The normalizer re-derives the invariant each time and throws `ProviderUnmanagedStateError` if it's now broken. This already has direct precedent: `isSdkAuthoredSchedule` is re-checked on *every* `normalizeStripeSubscription`, not trusted from a one-time stamp. Consistent with playbook §14's "we mark the boundary; callers handle the fallback — fail loud." Cost: every read re-runs the invariant check (for products, that's "list this product's prices and confirm a single model").
- **Trust the marker.** Cheaper reads, but a natively-drifted resource silently returns a malformed normalized object — violates the "fail loud" philosophy and is hard to debug downstream.

The schedule-marker precedent strongly suggests **re-validate on read** is the house style; the design work is mostly (a) generalizing it from one ad-hoc check into a per-domain ownership/import primitive, and (b) deciding the read-cost tradeoff (e.g. only re-validate on `get`, accept eventual-consistency on `list`, or expose a `validated: boolean` on the model).

**What the next agent should do:**

1. Decide (A) vs (B). Recommendation: **(B) import + re-validate-on-read**, because real users have existing catalogs (A is too strict) and re-validate-on-read already has precedent (answers the drift question by failing loud on next read instead of returning malformed data).
2. Inventory which normalized invariants this unlocks beyond product-price-model (quantity bounds enforcement on native prices, etc.) — the design should be a primitive, not a product-only patch.
3. Decide the ownership marker + reserved key (new `__provider_*` key = contract change; see §`__provider_*` reserved keys) and whether `import` is a new optional domain method or a cross-cutting helper.
4. Pin it down **before** the Polar adapter's `products`/`prices` are written — Polar enforces product-level price model natively, so it's the reference for what the normalized invariant should look like, and the Stripe adapter's enforcement should mirror Polar's native guarantee.

This decision does **not** block starting the Polar adapter's other domains, but `products`/`prices` should not be finalized until it's settled, or they'll need a second pass.

---

## Stripe playbook

**Status: the Stripe adapter is built.** This section was originally written as a forward-looking guide. It's kept here because the patterns it describes (five-step recipe, helper usage, error mapping shape, fixture wiring) are the same ones a new adapter author should follow. The retrospective live-test lessons live in [§Stripe quirks & lessons](#stripe-quirks--lessons) below — read those too.

The mock implementation in `packages/provider-mock/` is the reference: same package layout, same five-step recipe per method, same conformance wiring. Adapter-specific differences are real HTTP, real error shapes, real metadata limits, and provider-specific managed-state tricks (quantity in metadata, tax-code translation, anonymous-code marker, restrictedTo metadata stash, SDK-schedule marker).

### Read first

- **`packages/provider-mock/src/`** — every domain implementation is a working example you can mirror almost line-for-line. Steal the structure, swap in Stripe calls.
- **`packages/provider-mock/src/__tests__/native.test.ts`** — the validation paths you'll need to replicate (archived customer in checkout, inactive price in change, mixed-currency rejection, quantity-bound enforcement, admin quantity validation).
- **`docs/openapi/*.json`** — the source of truth for input/output shapes per method.

### Getting started

```bash
pnpm -w turbo run build                              # Build SDK first; adapter resolves against dist/
pnpm --filter @its-just-billing/provider-stripe typecheck

cd packages/provider-stripe

# Skeleton already exists. Fill in:
#  src/index.ts             — createStripeProvider, StripeProvider type
#  src/client.ts            — Stripe SDK wrapper (apiKey, apiVersion)
#  src/capabilities.ts      — taxCategories, currencies sets
#  src/tax-codes.ts         — TaxCategory ⇄ txcd_* lookup
#  src/error-mapping.ts     — mapStripeError(err, methodLabel)
#  src/presentation.ts      — StripeCheckoutPresentation union
#  src/normalize/*.ts       — Stripe.X → ProviderX functions
#  src/domains/*.ts         — one per domain
#  src/harness.ts           — createStripeHarness with assertConsistency
#  src/__tests__/conformance.automated.spec.ts
#  src/__tests__/conformance.self-setup.spec.ts
#  src/__tests__/conformance.fixture.spec.ts (gated on env-var fixtures)
```

Domain implementation order that matches mock's complexity progression: customers → products → prices → discounts → checkout → payments → subscriptions → events → webhooks.

### Stripe-specific things the mock doesn't model

These are the parts of the playbook (§§5–14) that the mock didn't need to exercise but Stripe does:

- **Quantity in metadata** — Stripe has no native price-level quantity bounds. Use `encodeQuantityToMetadata` / `decodeQuantityFromMetadata`. `defaultQuantityFor(kind)` on create when caller omits. `UNMANAGED_QUANTITY_DEFAULT` ({min:1, max:999_999}) is the read-side fallback for prices created outside the SDK — don't pre-reject quantities Stripe would accept.
- **Tax-code translation** — `TAX_CATEGORY_TO_STRIPE` and a reverse map for normalize. Verify the `txcd_*` codes against the live Stripe Tax Codes API; the placeholder codes in playbook §7 are illustrative. Unmapped codes on read surface as `'other'`, with the raw code stashed in `__provider_tax_category_raw` metadata. See `RESERVED_METADATA_KEYS.TAX_CATEGORY_RAW` in the SDK.
- **Pagination translation** — Stripe uses `starting_after` + `has_more`. Translate to/from the SDK's opaque cursor; cursor format is the adapter's concern (return the last item's id when `has_more`, otherwise `null`).
- **`subscription_schedule`** — if you read a Stripe subscription whose schedule wasn't authored by the SDK (e.g. dashboard-created), throw `ProviderUnmanagedStateError` rather than try to normalize it.
- **Real HTTP errors** — `error-mapping.ts` translates `Stripe.errors.StripeError` subclasses into the normalized hierarchy by `statusCode`. Pattern in playbook §10.
- **Real assertConsistency** — every harness verifier does a fresh `stripe.*.retrieve(id)` and compares to the normalized output. The mock skips this because in-memory state IS the source of truth; Stripe's existing state may have drifted between the adapter call and the verifier.

### Use these SDK helpers verbatim

The mock pulled in helpers as we found gaps. Stripe should use the same set:

| Helper | Module | Use |
|---|---|---|
| `validate(schema, input, label)` | `@its-just-billing/provider-sdk` | At the top of every public method. |
| `assertNoReservedKeys(metadata, label)` | same | After validate, before any provider call, on every input that has metadata. |
| `stripReservedKeys(metadata)` | same | In every normalizer that surfaces a metadata field. |
| `assertQuantityWithinConstraint(value, q, label)` | same | In `checkout.createSession` (line items), `subscriptions.change` (items), `admin.createSubscription` (input quantity). |
| `defaultQuantityFor(kind)` | same | On `prices.create` when caller omits `quantity`. |
| `assertSameCurrency(a, b, label)` | same | Whenever you sum or compare two Money values. |
| `encodeQuantityToMetadata` / `decodeQuantityFromMetadata` | same | Quantity round-trip via metadata (Stripe-specific). |

### Contract checks the mock added (review-driven; replicate them)

These came out of PR review on the mock. Every adapter that follows the same contract owes them:

1. **`checkout.createSession`** must reject:
   - Inactive prices (`!price.active`) → `ProviderConstraintError`.
   - Inactive discounts (lookup-by-id OR lookup-by-code paths) → `ProviderConstraintError`.
   - Archived customers (`customer.archived` or Stripe `deleted: true`) → `ProviderNotFoundError`.
   - Mixed-currency line items (track currency from the first line item, reject any other) → `ProviderConstraintError`.
   - Per-line-item quantity outside the price's quantity bounds → `ProviderConstraintError`.
2. **`subscriptions.change`** must validate each item's price (`exists`, `active`, `kind === 'recurring'`) and call `assertQuantityWithinConstraint` against the price's quantity. Also must set `cancelAtPeriodEnd = false` whenever called — a `change()` always overrides any prior scheduled cancellation.
3. **`webhooks.verify`** must parse the decoded JSON payload through `ProviderEventSchema.safeParse`, not a hand-rolled shape check. Unknown event types / resource kinds / unparseable `occurredAt` strings must surface as `WebhookSignatureError`, not return a malformed event. JSON encodes `occurredAt` as a string — coerce to Date before `safeParse`.
4. **Return optional `payload` / `raw` fields from verified events** — `eventResult.data` includes them when present; don't drop them.
5. **Don't leak references** — Normalizers must defensively clone:
   - **Dates** — `new Date(d.getTime())` so callers can't `c.createdAt.setTime(0)` into provider state. Use `provider-mock/src/clone-date.ts` as a pattern.
   - **`quantity`** on prices — `{ ...q }` on both read and write paths.
   - Caller-supplied metadata, items arrays, line items, etc. — already cloned in the mock; mirror it.
6. **`webhooks.listEndpoints`** ignores cursor/limit (Stripe also returns paged endpoints, but `WebhooksListEndpointsInputSchema` has no cursor/limit — see if you need to add pagination to the schema or just iterate Stripe's paging and return everything in one shot; the mock returns everything with `nextCursor: null`).

### Conformance schema fixes already in the SDK

These three landed during mock work; the suites assume them, so don't worry about hitting them again:

- `DiscountApplication` union in `schemas/checkout/create-session.ts` has `.strict()` on each member, so `{ kind: 'discountId', discountId: '…', code: '…' }` is rejected as validation rather than letting Zod silently strip the extra field.
- `subscriptions.list` tests assert `out.data` shape (page envelope), not bare array.
- The `it.skipIf` → `lazySkipIf` migration (see §Patterns) — fixture and self-setup suites won't skip-everything against your harness anymore.

### Conformance harness: `assertConsistency` shape

The mock returns `undefined` for `assertConsistency`. Stripe should populate every applicable verifier. Pattern per model:

```ts
// in createStripeHarness
async customer(output) {
  const native = await stripe.customers.retrieve(output.id);
  if ('deleted' in native && native.deleted) throw new Error(`consistency: customer ${output.id} is deleted`);
  if (native.email !== output.email) throw new Error(`consistency: email mismatch`);
  if (native.name !== output.name) throw new Error(`consistency: name mismatch`);
},
async subscription(output) {
  const native = await stripe.subscriptions.retrieve(output.id);
  if (native.status !== output.status) throw new Error(`status ${output.status} vs ${native.status}`);
  if (native.cancel_at_period_end !== output.cancelAtPeriodEnd) throw new Error(`cancelAtPeriodEnd mismatch`);
  if (native.items.data.length !== output.items.length) throw new Error(`item count mismatch`);
},
// ... per model (product, price, discount, payment, webhookEndpoint)
```

Run after every successful write in conformance — the SDK already calls `harness.assertConsistency?.<model>?.(out)` in the right places. You just have to provide the function.

### Env-var fixtures

The fixture suite gates each scenario on `harness.fixtures.<id>`. The mock seeds these in-process; Stripe should pull them from env vars so they survive between runs. Document required vars in `harness.ts` JSDoc:

```ts
// Required by the fixture suite:
//   STRIPE_TEST_API_KEY              — Stripe test-mode secret key
//   STRIPE_FIXTURE_CUSTOMER_ID       — active customer, no caller metadata
//   STRIPE_FIXTURE_PRODUCT_ID        — active product, taxCategory in capabilities
//   STRIPE_FIXTURE_RECURRING_PRICE_ID — active recurring price on the product
//   STRIPE_FIXTURE_ONE_TIME_PRICE_ID  — active one-time price on the product
//   STRIPE_FIXTURE_SUBSCRIPTION_ID    — active subscription on a DIFFERENT recurring price (see mock harness comment)
//   STRIPE_FIXTURE_DISCOUNT_ID        — active discount
//   STRIPE_FIXTURE_WEBHOOK_ENDPOINT_ID — active webhook endpoint
```

The `STRIPE_FIXTURE_SUBSCRIPTION_ID` MUST be on a different recurring price than `STRIPE_FIXTURE_RECURRING_PRICE_ID` — otherwise the price-change fixture scenario short-circuits (it skips when the subscription is already on the swap target). The mock harness comment explains this; Stripe needs to provision two recurring prices in test mode and document which is which.

### Self-setup capabilities

The mock can self-create subscriptions and complete payments via `admin.createSubscription` / `admin.completePayment`. Stripe can also do both, but completing a payment requires a test-mode payment method. Strategy:

- `setup.createSubscription` — use `stripe.subscriptions.create({ customer, items: [{ price, quantity }], payment_behavior: 'default_incomplete' })` and (depending on price) either attach a test PaymentMethod or rely on the default test card. Normalize the result and return.
- `setup.completePayment` — Stripe doesn't expose a public "complete this checkout session" API. Options: (a) skip — leave `completePayment` undefined, accept that self-setup payment tests will skip cleanly; (b) construct a `PaymentIntent` + `Charge` directly and synthesize a payment. Option (a) is the pragmatic answer.

### Sanity checks before you call it done

```bash
pnpm -w turbo run build
pnpm --filter @its-just-billing/provider-stripe typecheck
pnpm --filter @its-just-billing/provider-stripe test     # automated suite only; no fixtures needed
# With env vars set:
STRIPE_TEST_API_KEY=sk_test_… pnpm --filter @its-just-billing/provider-stripe test:conformance:automated
STRIPE_TEST_API_KEY=sk_test_… STRIPE_FIXTURE_CUSTOMER_ID=cus_… … pnpm --filter @its-just-billing/provider-stripe test
pnpm --filter @its-just-billing/provider-sdk check:conformance-purity
npx biome check packages/provider-stripe/
```

Success criterion: every conformance test either passes against your harness or skips cleanly when a fixture is missing. The mock's 921-test green run is the benchmark — Stripe lands at 890 pass / 6 skip / 0 fail (the 6 skips are `payments.completePayment` paths that Stripe has no public API for).

---

## Stripe quirks & lessons

What came out of live test runs that the original playbook didn't anticipate. **Read these before writing a second adapter** — most of these have analogs on other providers.

### Metadata writes merge, not replace

Stripe metadata updates merge with existing keys; to delete a key you must send it with an empty-string value. The SDK contract for `update.metadata` is **replace** semantics. The adapter has a `diffMetadataForReplace(newMetadata, currentNative)` helper (`packages/provider-stripe/src/metadata-diff.ts`) that pre-fetches current metadata and synthesizes the empty-string deletes for keys no longer present. Applied to customers, products, prices, and discounts updates.

Reserved `__provider_*` keys are NEVER touched by this helper — adapter-managed state (quantity bounds, anonymous-code marker, etc.) survives caller-driven metadata replacements.

There's also a sibling bug: when re-encoding `Quantity` on update, `encodeQuantityToMetadata` only emits `__provider_quantity_max` when the new quantity has a max. The merge semantics mean a previously-set max persists if you don't explicitly delete it. The price update path stamps `__provider_quantity_max: ''` when the new quantity is unbounded.

### Stripe's permission boundaries are tighter than the contract

- **Description on products**: empty string rejected on create ("cannot be unset"). Update accepts empty string but only as "leave alone" not "clear". This forced an SDK contract tightening: `ProductsCreateInput.description = string().min(1).nullable().optional()`, `ProductsUpdateInput.description = string().min(1).optional()` — description is omit-or-non-empty, immutable-once-set.
- **Discount amount**: `amount_off >= 1` minimum. Forced SDK contract tightening: amount benefit must be strictly positive.
- **Discount `expires_at`**: create-only on PromotionCode. Forced SDK contract: `expiresAt` removed from `DiscountsUpdateInputSchema` entirely; Zod strips it like `active` on product/price update.
- **Discount `expires_at` 5-year future cap**: real Stripe limit. Conformance tests originally hardcoded `2099-01-01`; switched to a runtime-computed 4-year-future date (`futureExpiration()`) floored to whole seconds so the round-trip matches Stripe's per-second storage.

### Discount identity: PromotionCode, not Coupon

Stripe coupons can't be soft-deleted (only hard `del`), and have no public-facing redemption code. PromotionCode has both `active` and `code`. The adapter creates a Coupon + PromotionCode pair per discount and uses the PromotionCode id as the public identity. Implications:

- `discount.code === null` (caller didn't pick one) — store `__provider_anonymous_code: '1'` marker so the normalizer surfaces null instead of Stripe's auto-generated code.
- `restrictedTo.{productIds, priceIds}` — Stripe's `applies_to` only supports productIds, rejects unknown ids, has no priceIds equivalent. Stash both in reserved metadata (`__provider_restricted_products`, `__provider_restricted_prices`) and don't pass `applies_to` to Stripe. Caller round-trip works; actual enforcement is metadata-only on Stripe (callers needing real restriction drop to `provider.raw`).
- **Coupon events must NOT map to `discount.*`** — they carry the coupon id, not the promo id; consumers couldn't refetch via `discounts.get`. Only `promotion_code.*` events surface as discount events.

### Subscription quirks

- **`canceled_at` never clears.** Stripe stamps it when cancel is requested (immediate or at_period_end) and leaves it set forever, even after reverting `cancel_at_period_end`. The contract treats `canceledAt` as the "actually canceled" timestamp, so the normalizer returns null whenever `status !== 'canceled'`.
- **`paused` status** is not in the SDK enum. Normalizer throws `ProviderUnmanagedStateError` — pause isn't modeled by the contract.
- **`subscription_schedule`** without the SDK marker throws `ProviderUnmanagedStateError`. SDK-authored schedules carry `__provider_sdk_schedule: '1'` on the schedule's metadata (NOT the subscription's, since sub metadata is public).
- **`change(at_period_end)`** is implemented via SubscriptionSchedules: create from_subscription, override phase 0's `end_date` to `current_period_end` (because Stripe's auto-populated phase 0 ends a billing cycle past trial for trialing subs, not at trial end), add phase 1 with `iterations: 1` and `end_behavior: 'release'`. The schedule release happens on `cancelScheduledChange`, on `cancel(immediately)`, and at the start of `change(immediately)` to avoid conflict.
- **`incomplete` subs are mutation-blocked.** Stripe rejects invoice-affecting changes on `incomplete` subs. The harness's `setup.createSubscription` uses `trial_period_days: 365` to land in `trialing` status; `payment_behavior: 'default_incomplete'` would create a sub the conformance change/cancel tests can't operate on.

### Pagination traps

- **Inline expansion is paginated.** Stripe's `expand: ['line_items']` on a checkout session retrieve only returns the first page (~10 items). Use `stripe.checkout.sessions.listLineItems(id, { limit: 100 })` with `for await ... of` auto-pagination instead, and pass the full list to the normalizer. The `normalizeStripeCheckoutSession` signature now requires `lineItems: CheckoutLineItem[]` so this can't silently regress.
- **List filters that translate to empty must short-circuit.** Naive event-types filter translation can produce an empty Stripe-side filter; passing no `types` to Stripe means "all events". Detect the empty case and return an empty page without calling Stripe (`packages/provider-stripe/src/domains/events.ts`).

### Cleanup is its own concern

The SDK contract intentionally exposes only soft-delete for most resources. Tests want hard-delete so the test account doesn't accumulate residue. The `ProviderTestHarness.cleanupResource?(kind, id)` hook (`packages/provider-sdk/src/conformance/harness.ts`) gives adapters that path. Stripe's harness implements it for:

- `'product'` → `stripe.products.del(id)` (fails if prices attached; the conformance afterAll loops are price-first-then-product ordered so price-free products delete cleanly).
- `'discount'` → resolve the underlying coupon id, `stripe.coupons.del(couponId)` cascades to drop the promotion code.
- `'customer'` → no-op (the contract's `customers.archive` already calls native `customers.del`).
- everything else → no-op (Stripe doesn't allow deleting prices, sessions, or subscriptions; webhook endpoints are hard-deleted via the contract method).

The seeded fixture product can't be deleted on Stripe (has prices), so it accumulates one archived product + three archived prices per fixture-suite run. The 30+ per-run automated-suite products + their coupons now hard-delete because they're price-free.

### Test-run prerequisites

- `STRIPE_TEST_API_KEY` must reach the vitest subprocess. Turbo strips env by default — `turbo.json` declares it (and `STRIPE_FIXTURE_*`) under each test task's `env` field.
- `vitest.config.ts` in the Stripe package sets `testTimeout: 30_000` / `hookTimeout: 30_000`. The schedule-creating subscription tests take 5+ seconds against real Stripe; the 5s vitest default isn't enough headroom.
- The harness self-seeds all fixtures by default (`seedFixtures: true` in the fixture spec file). Env-var fixtures still work as a "pin to existing resources" override but are not required.

---

## Capability profiles in generated docs

The generated OpenAPI stays a single provider-agnostic contract. Capability
conditioning is published as machine-readable context, not forked schemas:

- Each capability-affected operation in `docs/openapi/<domain>.json` carries an
  `x-capabilities` extension (`{name, whenTrue, whenFalse, affects?}`) and the
  Capability Matrix folded into its `description`. Both are single-sourced from
  `OPERATIONS[].capabilities` in `packages/provider-sdk/scripts/build-docs.ts`
  and injected by `injectCapabilityExtensions`. `checkCapabilityExtensionDrift()`
  fails the build if an `Op.capabilities` entry isn't reflected.
- `docs/openapi/capability-profiles.json` resolves each flag + value-set
  narrowing per provider. It is **merged** by `build-docs` from per-provider
  fragments `docs/openapi/profiles/<id>.json`, which each adapter emits from its
  real `*_CAPABILITIES` via `pnpm --filter @its-just-billing/provider-<id>
  profile:emit` (script: `packages/provider-<id>/scripts/emit-capability-profile.ts`).
- The SDK build script **must never import a provider** — it only reads/validates
  fragments (`parseProfileFragment` in `src/capability-profile.ts`, the
  single-sourced fragment shape). Root `docs:build` sequences
  `turbo run profile:emit && turbo run docs:build`. A provider snapshot test
  (`src/__tests__/capability-profile.test.ts`) fails if a committed fragment
  drifts from live `*_CAPABILITIES`; re-run `profile:emit` and commit.
- A consumer derives the effective per-provider shape from the shared schema +
  profile (e.g. `valueSetNarrowing.trialUnits.perProvider`). Full per-provider
  schema docs were deliberately not generated (contradicts the agnostic
  contract; the profile gives the same information without forking schemas).

## Reference

- Spec: [`../provider-system-v2.md`](../provider-system-v2.md)
- Two-agent test pipeline: [`./test-process.md`](./test-process.md)
- README (caller-facing): [`../README.md`](../README.md)
- Harness types: `packages/provider-sdk/src/conformance/harness.ts`
- Fixture runner: `packages/provider-sdk/src/conformance/fixture-runner.ts`
- Purity guard: `packages/provider-sdk/scripts/check-conformance-purity.ts`
- Public exports: `packages/provider-sdk/src/index.ts`
- Conformance public exports: `packages/provider-sdk/src/conformance/index.ts`
