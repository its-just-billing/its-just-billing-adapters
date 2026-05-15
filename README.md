# its-just-billing-adapters

> One typed REST-style client. Multiple billing providers. Same shape.

A TypeScript SDK that normalizes Stripe, Paddle, and a reference mock provider behind a single `BillingProvider` interface. Callers consume it like any well-written typed REST client — each method takes a normalized input, the adapter maps it to the provider's native API, calls the provider, and normalizes both the response and any errors back into the shared contract.

**Status:** pre-1.0. Public interface complete; mock/Stripe/Paddle adapters not yet implemented.

---

## Contents

- [What's in the box](#whats-in-the-box)
- [Quick start](#quick-start)
- [Examples](#examples)
- [The big rule: manage lifecycle through the SDK](#the-big-rule-manage-lifecycle-through-the-sdk)
- [Provider dashboard recommendations](#provider-dashboard-recommendations)
- [The contract at a glance](#the-contract-at-a-glance)
- [Errors](#errors)
- [Pagination](#pagination)
- [Checkout: partly normalized, partly provider-specific](#checkout-partly-normalized-partly-provider-specific)
- [Conformance](#conformance)
- [Repo layout](#repo-layout)

---

## What's in the box

- **`@its-just-billing/provider-sdk`** — the contract. Zod schemas, TS interfaces, error classes, helpers, conformance runner.
- **`@its-just-billing/provider-mock`** — in-memory reference adapter (under construction).
- **`@its-just-billing/provider-stripe`** — Stripe adapter (under construction).
- **`@its-just-billing/provider-paddle`** — Paddle adapter (under construction).
- **`docs/`** — handwritten REST-style reference pages and generated OpenAPI fragments.
- **`provider-system-v2.md`** — the design spec the implementation is built against.

The SDK is provider-agnostic. The same caller code works against any adapter that implements `BillingProvider`.

---

## Quick start

```bash
pnpm install
pnpm -w turbo run build       # build all packages
pnpm -w turbo run test        # run unit + helper tests
pnpm --filter @its-just-billing/provider-sdk docs:build   # regenerate docs/openapi/*
```

Once an adapter is installed:

```ts
import { safe } from '@its-just-billing/provider-sdk';
import { createStripeProvider } from '@its-just-billing/provider-stripe';

const provider = createStripeProvider({ apiKey: process.env.STRIPE_SECRET_KEY! });

const customer = await provider.customers.create({
  email: 'jane@example.com',
  name: 'Jane Doe',
  metadata: { internalUserId: 'u_42' },
});
```

Want explicit branching instead of throws? Wrap any call in `safe()`:

```ts
const result = await safe(() => provider.customers.get({ id: 'cus_missing' }));
if (!result.ok) {
  reply.code(result.status).send(result.error.toJSON());
  return;
}
```

---

## Examples

### Create a product + price + checkout session

```ts
const product = await provider.products.create({ name: 'Pro plan' });

const price = await provider.prices.create({
  productId: product.id,
  currency: 'usd',
  kind: 'recurring',
  unitAmount: 1999,                  // $19.99 in minor units
  interval: 'month',
});

const session = await provider.checkout.createSession({
  customerId: customer.id,
  lineItems: [{ priceId: price.id, quantity: 1 }],
  successUrl: 'https://yourapp.com/billing/success',
  cancelUrl:  'https://yourapp.com/billing/cancel',
});

// session.presentation is provider-specific — see "Checkout" below
```

### Process a webhook

```ts
import { WebhookSignatureError } from '@its-just-billing/provider-sdk';

app.post('/webhooks/billing', async (req, res) => {
  try {
    const event = await provider.webhooks.verify({
      payload: req.rawBody,                   // string or Uint8Array
      signature: req.headers['stripe-signature'] as string,
      secret: process.env.WEBHOOK_SECRET!,
    });
    await handleEvent(event);                 // normalized ProviderEvent
    res.sendStatus(200);
  } catch (err) {
    if (err instanceof WebhookSignatureError) return res.sendStatus(400);
    throw err;
  }
});
```

### Paginate

Page-by-page, when you control progress (resumable, page-by-page UI, batch processing):

```ts
let cursor: string | undefined;
do {
  const page = await provider.products.list({ cursor, limit: 50 });
  await batchInsert(page.data);
  cursor = page.nextCursor ?? undefined;
} while (cursor);
```

Stream everything, when you just want to process every match:

```ts
import { paginate } from '@its-just-billing/provider-sdk';

for await (const product of paginate(
  (cursor) => provider.products.list({ cursor, active: true }),
)) {
  await process(product);
  if (enough) break;          // generator stops fetching
}
```

### Soft-delete and restore

`products`, `prices`, and `discounts` use `active: boolean` as a soft-delete flag. The flag is **not** mutable via `create` or `update` — use the dedicated methods:

```ts
await provider.products.deactivate({ id: product.id });   // active: false
await provider.products.activate({ id: product.id });     // active: true
```

`customers` uses `archive({ id })` (terminal in some providers; soft in others).

`webhooks` is different — `active` is a real send/don't-send toggle, not a soft-delete. It's settable via `updateEndpoint`, plus convenience wrappers:

```ts
await provider.webhooks.updateEndpoint({ id, active: false });
await provider.webhooks.activateEndpoint({ id });
await provider.webhooks.deactivateEndpoint({ id });
await provider.webhooks.deleteEndpoint({ id });           // hard delete
```

---

## Dashboard usage: what works, what breaks

The SDK reads the world as-is. Dashboard- and external-tool-created resources are fully supported as long as they only exercise features inside the normalized subset. Specifically:

| Resource / action                                                              | SDK behavior                                                                              |
|--------------------------------------------------------------------------------|--------------------------------------------------------------------------------------------|
| Products created in the provider dashboard                                     | ✅ Read and write fine. Tax code maps to the normalized `TaxCategory` enum, or `'other'` if outside it (raw code preserved in `__provider_tax_category_raw`). |
| Prices created in the dashboard                                                | ✅ Read and write fine. Quantity behavior is **provider-native** when the provider supports it (Paddle reads its own quantity fields) and **permissive-default `{ min: 1, max: 999_999 }`** when it doesn't (Stripe, without managed metadata). |
| Customers created in the dashboard                                             | ✅ Fully supported.                                                                       |
| Subscriptions created via dashboard checkout / hosted checkout                 | ✅ Subscriptions are inherently created by buyers completing checkout. Read/cancel/change as normal. |
| Webhook endpoints created in the dashboard, subscribing to all provider events | ✅ Fine. The SDK silently filters non-normalized event types on read and verify. Endpoints listed via `listEndpoints` only surface event types in the normalized enum. |
| Discounts/coupons created in the dashboard                                     | ✅ Fine if configured within the normalized lifecycle subset (benefit shape, duration kinds, restrictedTo). |

The **one** thing that breaks normalization: **subscription schedules with non-normalized phases**. The contract's `subscriptions.change({ when: 'at_period_end' })` uses the provider's scheduling primitive in a specific way. If you hand-author a Stripe subscription schedule with multiple custom phases, the SDK can't safely surface that through `pendingChange`. On read, the adapter throws `ProviderUnmanagedStateError`.

```ts
import { ProviderUnmanagedStateError } from '@its-just-billing/provider-sdk';

try {
  const sub = await provider.subscriptions.get({ id });
} catch (err) {
  if (err instanceof ProviderUnmanagedStateError) {
    logger.warn('Unmanaged provider state', {
      field: err.field, expected: err.expected, found: err.found,
    });
    // Fall back to the raw provider client
    const native = await (provider.raw as Stripe).subscriptions.retrieve(id);
  } else {
    throw err;
  }
}
```

### Cross-provider capability gaps

Some normalized values aren't supported on every provider. For example, a Stripe-only currency won't work on Paddle. The SDK exposes this through two surfaces:

**Pre-flight via `capabilities`** — typed sets exposed on each provider:

```ts
if (provider.capabilities.taxCategories.has('saas')) {
  await provider.products.create({ name: 'Pro plan', taxCategory: 'saas' });
}

if (provider.capabilities.currencies.has('usd')) {
  await provider.prices.create({ ..., currency: 'usd', kind: 'recurring', unitAmount: 1999, interval: 'month' });
}
```

**Defense at call time via `ProviderNotSupportedError`** — fires when a caller skips the pre-flight check:

```ts
import { ProviderNotSupportedError } from '@its-just-billing/provider-sdk';

try {
  await paddle.prices.create({ ..., currency: 'xyz', kind: 'one_time', unitAmount: 1000 });
} catch (err) {
  if (err instanceof ProviderNotSupportedError) {
    // err.feature === 'currency', err.value === 'xyz'
    // Route to a different provider, or substitute.
  }
}
```

The `capabilities` surface is intentionally narrow — currently `taxCategories` and `currencies`. New axes go in only when a real cross-provider gap exists.

### Typed raw escape hatches

Two escape hatches, both typed when you use an adapter-specific provider type:

**`provider.raw`** — the underlying provider client. For provider-specific features the SDK doesn't model (Stripe Tax, Paddle Retain, full Stripe `txcd_*` taxonomy, etc.).

**`response.raw`** — every normalized response carries an optional `raw` field with the provider-native object that produced it. Useful when you need one field the SDK doesn't normalize without making a second round-trip.

Both are `unknown` in adapter-agnostic code and fully typed when you use the adapter's narrowed provider type:

```ts
import { createStripeProvider, type StripeProvider } from '@its-just-billing/provider-stripe';

const provider: StripeProvider = createStripeProvider({...});

// Top-level client:
await provider.raw.subscriptions.cancel('sub_123');  // typed as Stripe

// Per-response raw:
const sub = await provider.subscriptions.get({ id });
sub?.raw?.schedule;          // typed as Stripe.SubscriptionSchedule | null | undefined
sub?.raw?.latest_invoice;    // typed
```

Adapter authors thread their concrete raw type into each domain via interface extension:

```ts
// inside provider-stripe
export interface StripeProvider extends BillingProvider<StripeCheckoutPresentation> {
  readonly raw: Stripe;
  subscriptions: Subscriptions<Stripe.Subscription>;
  purchases: Purchases<Stripe.Charge>;
  customers: Customers<Stripe.Customer>;
  // ...narrow whichever domains you want typed
}
```

Resources touched through `provider.raw` may surface `ProviderUnmanagedStateError` on the next normalized read if they exercise features outside the normalized subset. `response.raw` is read-only and never triggers this.

---

## Provider dashboard recommendations

The SDK assumes you're driving the lifecycle. Configure each provider's dashboard to keep dashboard users from creating drift.

### Universal — customer portal

Whichever provider you use, the customer self-service portal should be **scoped down to operations the SDK can detect and normalize**. Recommended settings:

| Portal feature                            | Recommendation                              | Why |
|------------------------------------------|---------------------------------------------|-----|
| **Cancel subscription**                  | ✅ Enable                                    | The contract has `cancel` and `cancelScheduledChange`; both directions normalize. |
| **Reactivate / undo cancellation**       | ✅ Enable                                    | Maps to `cancelScheduledChange` in the contract. |
| **Update payment method**                | ✅ Enable                                    | Doesn't change normalized state the SDK reasons about. |
| **Update billing email / address**       | ✅ Enable                                    | Customer-level mutation; SDK reads round-trip fine. |
| **Switch subscription plan / price**     | ⚠️ **Disable when using multiple providers** | Provider-native plan-change semantics differ on proration, lock-in, downgrade rules. The SDK's `subscriptions.change` is the only way to get consistent upgrade/downgrade behavior. With a single provider you *may* enable this — accept that you need to detect the change and reflect it in your own state. |
| **Add / remove subscription items**      | ⚠️ **Disable**                              | Same reason — multi-item subscriptions are modeled, but multi-provider parity isn't guaranteed without the SDK driving the change. |
| **Apply coupon / promotion code**        | ⚠️ Depends                                  | If you create all discounts via the SDK and surface them as portal-available codes, this is fine. If portal users can paste any code, expect `ProviderUnmanagedStateError` on subsequent reads. |
| **Download invoices / billing history**  | ✅ Enable                                    | Read-only. |

The short version: **enable cancel/uncancel, disable plan changes** unless you're committed to a single provider and have downstream code that handles change detection.

### Stripe-specific

- **Billing → Customer portal → Configuration:** mirror the universal table. Turn off "Customers can switch plans" and "Customers can update quantities" when running multi-provider.
- **Products and prices:** create them through the SDK or seed scripts. Avoid the Stripe dashboard's product/price builder for anything the SDK reads — quantity constraints and managed metadata will be absent.
- **Subscription schedules:** don't create them in the dashboard. The SDK uses Stripe schedules internally for `subscriptions.change({ when: 'at_period_end' })`; hand-authored schedules will trip `ProviderUnmanagedStateError`.
- **Webhooks:** create endpoints through `provider.webhooks.createEndpoint` so the SDK can manage event-type sets. If you create endpoints in the dashboard, the SDK can still verify their signatures, but `updateEndpoint`/`listEndpoints` may surface unfamiliar event types.
- **Tax, Radar, Sigma:** out of scope. Configure freely in the dashboard.

### Paddle-specific

- **Catalog products/prices:** create through the SDK. Paddle's native quantity-range fields are not the canonical source of truth — the SDK's adapter-managed metadata is.
- **Subscription plans:** avoid dashboard-managed plans whose proration / billing-cycle behavior differs from the SDK's `subscriptions.change` semantics.
- **Notifications (webhooks):** same rule as Stripe — create through the SDK.
- **Customer portal:** mirror the universal table; in particular, disable any "self-service plan change" options.

### Mock

The mock provider has no dashboard — it's an in-memory store for tests. The rules above don't apply.

---

## The contract at a glance

```ts
interface BillingProvider<TCheckoutPresentation = unknown> {
  readonly providerId: string;

  // Required domains — present on every real provider
  customers: Customers;
  products: Products;
  prices: Prices;
  subscriptions: Subscriptions;
  checkout: Checkout<TCheckoutPresentation>;
  purchases: Purchases;
  discounts: Discounts;
  events: Events;
  webhooks: Webhooks;

  // Optional domains — detect via object presence, no capabilities flag
  portal?: Portal;
  billingDocuments?: BillingDocuments;
  paymentMethods?: PaymentMethods;

  // Escape hatch — the underlying provider client, untyped
  raw?: unknown;
}
```

A few cross-cutting rules:

- **Monetary amounts** use minor units (cents) plus lowercase ISO currency.
- **Dates** are JS `Date` objects in UTC instants. Never ISO strings on the public surface.
- **IDs** are opaque strings. Don't pattern-match them.
- **Metadata** is a flat `Record<string, string>`. Keys starting with `__provider_` are reserved for the adapter — supplying one as a caller throws `MetadataCollisionError` (422).
- **Inputs are validated at runtime with Zod**, every public method. Validation fails before any provider API call.

---

## Errors

All errors extend `ProviderError` and carry `status`, `code`, `message`, optional `cause`, optional `providerCode`, optional `details`. Catch by class:

| Class                            | Status | Code                | When                                                          |
|----------------------------------|--------|---------------------|---------------------------------------------------------------|
| `ProviderValidationError`        | 400    | `validation`        | Invalid caller input (Zod failure).                           |
| `ProviderAuthError`              | 401/403| `authentication` / `authorization` | Missing or rejected API key.                |
| `ProviderNotFoundError`          | 404    | `not_found`         | Resource not found on a method that throws (vs. get → null). |
| `ProviderConflictError`          | 409    | `conflict`          | Duplicate or conflicting state.                              |
| `ProviderConstraintError`        | 422    | `constraint`        | Provider rejected a structurally valid request.               |
| `MetadataCollisionError`         | 422    | `metadata_collision`| Caller metadata used a reserved `__provider_*` key.           |
| `ProviderUnmanagedStateError`    | 422    | `unmanaged_state`   | Adapter detected state created outside the SDK's lifecycle.   |
| `ProviderNotSupportedError`      | 422    | `not_supported`     | Caller passed a value the active provider can't honor (see `capabilities`). |
| `ProviderRateLimitError`         | 429    | `rate_limit`        | Provider rate-limited; may carry `retryAfterSeconds`.         |
| `ProviderNormalizationError`     | 502    | `normalization`     | Provider response can't be mapped to the contract.            |
| `ProviderUnavailableError`       | 5xx    | `unavailable`       | Provider 5xx or transport failure.                            |
| `WebhookSignatureError`          | 400    | `webhook_signature` | Signature verification failed.                                |

Prefer the throwing API in happy-path code. Use `safe(() => ...)` for explicit `{ ok, status, data | error }` branching at request boundaries.

---

## Pagination

List methods return a **forward-only** page envelope:

```ts
type Page<T> = { data: T[]; nextCursor: string | null };
```

Cursors are SDK-opaque strings — adapters translate to whatever the provider uses natively (Stripe `starting_after`, Paddle `after`). For back-navigation, callers maintain a cursor stack themselves.

For "give me everything" ergonomics, use `paginate(fetchPage)` to wrap any list into an `AsyncIterable<T>`. See [Examples](#paginate).

---

## Checkout: partly normalized, partly provider-specific

Checkout is the one domain that crosses the backend/frontend boundary, so its output is partly normalized and partly provider-specific. The normalized fields (`id`, `status`, `lineItems`, `successUrl`, `cancelUrl`, `customerId`, `metadata`, `expiresAt`, `createdAt`) are stable across providers. The `presentation` field is **opaque at the SDK boundary** — each adapter declares its own shape.

```ts
// Adapter-agnostic callers: TPresentation defaults to unknown
const provider: BillingProvider = ...;
const session = await provider.checkout.createSession(...);
session.presentation;   // unknown — must cast or narrow

// Adapter-aware callers: narrow the parameter for full typing
type StripeProvider = BillingProvider<{ kind: 'hosted'; url: string } | { kind: 'embedded'; clientSecret: string }>;
const stripe: StripeProvider = createStripeProvider(...);
const s = await stripe.checkout.createSession(...);
if (s.presentation.kind === 'hosted') redirect(s.presentation.url);
```

---

## Conformance

The conformance suite lives inside `@its-just-billing/provider-sdk` and tests any provider that implements `BillingProvider`. Four suite tiers, each with a distinct setup contract:

| Tier | When it runs | Setup contract |
|---|---|---|
| **automated** | Every harness, unconditionally. | Setup is fully achievable through the SDK alone (e.g. create a customer, list it). |
| **self-setup** | Per-test, gated on optional `harness.setup.<capability>`. | Harness exposes capabilities the SDK can't model (e.g. `createSubscription` on Stripe). Tests covering lifecycle scenarios skip when the capability is absent. |
| **semi-manual** | `INTERACTIVE=1` only. | Harness exposes `prompt()`. Suite covers non-reversible flows (e.g. completing a checkout) by asking the developer to perform the step, then polling. |
| **fixture** | When `harness.fixtures.<id>` is declared for the relevant resource. | Caller points env vars at pre-provisioned resources (one subscription, one product, etc.). Each test health-checks the resource, exercises reversible operations, and reverts. Reduces manual burden for cancel-then-uncancel / update-then-revert scenarios on providers that can't self-create state. |

**Independent verification: `harness.assertConsistency`.** Conformance only verifies normalized input/output shape. An adapter that fakes responses from in-memory state could pass without ever calling the provider. The harness optionally exposes per-model verifier hooks (`assertConsistency.subscription(output)` etc.) that make a fresh native call via the provider's own SDK and assert the normalized output matches reality. Conformance calls these after every write. Harnesses without the hook skip the check; harnesses with it get an independent ground-truth assertion across every test.

Tests are written **implementation-unaware** via a two-agent pipeline documented in [`docs/test-process.md`](./docs/test-process.md): one agent reads only the contract and produces a plain-English brief; a second agent reads only the brief and writes vitest code. A purity guard (`pnpm --filter @its-just-billing/provider-sdk check:conformance-purity`) fails CI if any conformance file imports a provider implementation package.

For deeper provider-specific assertions (webhook emission timing, async settlement, provider-only features), adapter packages may maintain their own native test suites alongside conformance.

For a full provider-implementation handoff — adapter patterns, helper inventory, error mapping, the `validate → map → call → normalize` recipe, conformance harness wiring, and what's next — see [`docs/handoff.md`](./docs/handoff.md).

---

## Repo layout

```
.
├── packages/
│   ├── provider-sdk/             # contract, schemas, errors, helpers, conformance runner
│   ├── provider-mock/            # in-memory reference adapter (in progress)
│   ├── provider-stripe/          # Stripe adapter (in progress)
│   └── provider-paddle/          # Paddle adapter (in progress)
├── docs/
│   ├── reference/<domain>/<method>.md   # handwritten per-method reference pages
│   ├── openapi/<domain>.json            # generated by `docs:build`
│   └── test-process.md                  # the two-agent conformance pipeline
├── provider-system-v2.md         # design spec
├── pnpm-workspace.yaml
├── turbo.json
└── tsconfig.base.json
```

---

## License

[MIT](./LICENSE) © Steven Chang
