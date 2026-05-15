# Provider SDK — Requirements

**Status:** Draft
**Date:** 2026-05-14

## 1. Purpose

This document specifies a typed REST API client across billing providers. Implementations expose one canonical, normalized contract; callers consume it the way they would consume any well-written typed REST client. Each method takes a normalized input, the adapter maps it to the provider-native API, calls the provider client, and normalizes both the response and any errors back into the shared contract.

The contract is provider-agnostic. The initial target providers are Stripe and Paddle. A mock provider is required for tests and demos.

## 2. Goals

- Support first-party providers only. No third-party adapter compatibility layer.
- Domain-presence-based optional support — no domain-level capabilities object. Within-domain value-set capabilities (which tax categories or currencies the active provider accepts) are exposed via a narrow `BillingProvider.capabilities` field for axes where providers genuinely diverge; adding a new capability axis is a deliberate contract change.
- Normalize provider models to one exact shape; only provider-native ID formats may differ.
- Keep products and prices as separate catalog resources, following the practical shape used by Stripe and Paddle.
- Normalize provider errors into API-client-style errors or responses, preserving meaningful HTTP semantics such as not found, conflict, rate limit, authentication, and provider unavailable.
- Runtime-validate all public method inputs as if they were backend request bodies, even though TypeScript types also describe those inputs.
- Document every public interface, type, option object, method, and error with Typedoc.
- Write conformance tests from black-box test briefs, not from implementation details.

## 3. Non-Goals

- Third-party adapter compatibility.
- Public subscription pause/resume normalization.
- Provider-specific model variants.
- Hidden cross-call state, caching, or sync inside the SDK.
- Throwing provider-native errors to callers.

## 4. Package Strategy

The repository ships at least four packages:

- `provider-sdk`: public interfaces, normalized models, response/error helpers, validation helpers, metadata helpers, and the conformance runner.
- `provider-stripe`: Stripe implementation.
- `provider-paddle`: Paddle implementation.
- `provider-mock`: simple reference provider for tests and demos.

Actual package names are an implementation choice; the technical contract does not depend on package naming.

## 5. Provider Contract

`BillingProvider` exposes normalized domains:

- Required for real providers: `customers`, `products`, `prices`, `subscriptions`, `checkout`, `purchases`, `discounts`, `events`, `webhooks`.
- Optional by object presence: `portal`, `billingDocuments`, `paymentMethods`.
- Mock implementations may run on a smaller runtime surface, but conformance must make those omissions explicit.

Support is determined by whether a domain exists. There is no `capabilities` object.

Successful provider operations return normalized models, either directly or in the success branch of the chosen response envelope. Provider adapters may expose the raw provider client separately for escape hatches, but raw provider data must not leak into normalized fields except through explicit `raw` opt-in fields.

Every normalized model exposes an optional `raw?: TRaw` escape-hatch field, typed through a per-domain `TRaw` generic that defaults to `unknown`. Each domain interface (`Customers<TRaw>`, `Subscriptions<TRaw>`, etc.) and each per-method output type threads `TRaw` through, so an adapter that declares its narrow type (`StripeProvider`) gets fully-typed `raw` on every response. Adapter-agnostic code keeps `TRaw = unknown` and treats `raw` as opaque. `BillingProvider` itself stays single-generic on `TCheckoutPresentation`; per-domain raw narrowing happens via interface extension in each adapter package.

Provider methods are request/response boundaries. Each method accepts one normalized input object unless a simpler primitive is clearly justified by API-client ergonomics. Adapters must not expose provider-native request fields at the public boundary.

The internal flow for every provider operation is:

1. Validate the normalized input at runtime.
2. Map the normalized input to the provider-native request.
3. Call the provider client.
4. Normalize the provider-native response.
5. Normalize provider errors into the shared error contract.

## 6. Normalized Model Rules

- All providers must return the same field names, nullability, enum values, date semantics, metadata behavior, and money units.
- Provider IDs are opaque strings. Tests may assert shape only where the contract requires an ID to round-trip.
- Monetary amounts use minor units plus lowercase ISO currency.
- Dates are JavaScript `Date` objects in UTC-equivalent instants.
- Unknown provider states must map to a documented SDK state or throw a normalization error if no safe mapping exists.
- Returned arrays must be stable enough for assertions after sorting by documented IDs or timestamps.

## 7. Response and Error Semantics

Provider adapters preserve meaningful API semantics instead of collapsing all failures into generic SDK errors.

Every provider operation must use one consistent public error strategy. The preferred shape is one of:

- API-style result envelopes, such as `{ ok: true, status, data }` and `{ ok: false, status, error }`.
- Throwing normalized error classes that include at least `status`, `code`, `message`, and optional `cause`.

The chosen strategy must be consistent across all domains and providers. If errors are thrown, helper functions may offer result-envelope ergonomics for callers that prefer explicit branching.

Normalized errors must distinguish at least:

- `400` validation errors for invalid caller input.
- `401` or `403` authentication and authorization failures from the provider.
- `404` not found responses.
- `409` conflict or duplicate-resource responses.
- `422` provider constraint failures when a valid normalized request cannot be represented by the provider.
- `429` rate limit responses.
- `5xx` provider failures and provider-unavailable transport failures.
- Webhook signature failures.
- Provider normalization failures when provider-native data cannot be safely mapped into the contract.
- Unmanaged-state detection when the adapter reads a resource that was created or modified outside the SDK lifecycle (e.g. subscription schedules the SDK did not author). Surface as `ProviderUnmanagedStateError` (`status: 422`, `code: 'unmanaged_state'`, carrying `field`, `expected`, `found`). The contract's normalized behavior holds for SDK-managed state and for dashboard-managed resources that only exercise the normalized feature subset; this error is the caller's signal that they have drifted into non-normalized features.
- Cross-provider capability gaps (e.g. a tax category or currency the active provider cannot honor). Surface as `ProviderNotSupportedError` (`status: 422`, `code: 'not_supported'`, carrying `feature` and `value`). Callers can pre-flight via `BillingProvider.capabilities`.

When a provider returns a concrete HTTP status, the normalized error must preserve that status unless the contract has a stronger documented abstraction. For example, a provider 404 surfaces as a 404-style normalized result or a `ProviderNotFoundError` carrying `status: 404`.

## 8. Runtime Input Validation

TypeScript types describe the intended input shape, but adapters must also validate all public inputs at runtime. Consumers can pass arbitrary values through `any`, JSON boundaries, or untyped code, so public method inputs must be treated like backend request payloads.

Validation rules:

- Required fields must be present and of the expected runtime type.
- IDs must be non-empty strings.
- Monetary amounts must be positive integer minor units unless a method explicitly allows zero.
- Currency codes must be lowercase ISO-style strings after normalization.
- Quantities must be positive integers and must satisfy normalized quantity constraints.
- Dates must be valid `Date` objects, or documented string inputs where the contract permits strings.
- URLs must be valid absolute URLs where provider redirects or hosted sessions require them.
- Metadata must be a flat string record.
- Caller metadata must not use reserved adapter-managed keys (see §11).
- Unknown fields may be ignored or rejected, but the behavior must be documented and tested consistently.

Validation failures are caller errors, not provider errors. They surface as normalized `400` validation responses or `ProviderValidationError` instances before any provider-native API call is attempted.

Validation is implemented with Zod, with one schema co-located per method. Schemas are exported so callers can compose them, but invoking the method without pre-validating remains the supported path.

## 9. Product and Price Domains

Products and prices are separate provider catalog resources. This keeps the contract close to the practical shapes exposed by Stripe and Paddle and avoids forcing product reads to carry nested price state.

`ProviderProduct` does not embed prices. Price reads and mutations happen through the `prices` domain.

Every `ProviderProduct` carries a normalized `taxCategory` field. The normalized enum aligns with Paddle's native category set so every value maps 1:1 on Paddle and to a specific `txcd_*` code on Stripe. `ProductsCreateInput.taxCategory` is required (`TaxCategory`). `ProviderProduct.taxCategory` is `TaxCategory | 'other' | null` — `'other'` for dashboard-created products whose provider-native code does not map to the normalized enum (the raw code is preserved in `__provider_tax_category_raw` for traceability via `provider.raw`); `null` when no tax category is set. Callers pre-flighting tax categories use `BillingProvider.capabilities.taxCategories`.

List methods return a paginated envelope `Page<T> = { data: T[]; nextCursor: string | null }`. Cursors are SDK-opaque strings; adapters translate them to provider-native pagination primitives. The contract is forward-only — callers needing back-navigation maintain a cursor stack. The SDK also exports a `paginate()` helper that wraps any list method into an `AsyncIterable<T>` for callers who want one-line "process everything" ergonomics.

Provider product methods:

- `products.list(input?): Promise<Page<ProviderProduct>>`
- `products.get(input): Promise<ProviderProduct | null>`
- `products.create(input): Promise<ProviderProduct>`
- `products.update(input): Promise<ProviderProduct>`
- `products.archive(input): Promise<ProviderProduct | null>`

Provider price methods:

- `prices.list(input?): Promise<Page<ProviderPrice>>` (filterable by `productId`)
- `prices.get(input): Promise<ProviderPrice | null>`
- `prices.create(input): Promise<ProviderPrice>`
- `prices.update(input): Promise<ProviderPrice>`
- `prices.archive(input): Promise<ProviderPrice | null>`

Price create input uses typed one-time and recurring shapes. Immutable-field updates are rejected as normalized constraint errors; adapters must not silently replace a price when the caller requested an update.

Every product or price mutation returns the normalized resource after provider operations complete. If the provider has read-after-write lag, the adapter may retry and may overlay just-written adapter-managed metadata into the returned normalized model when doing so prevents stale unsafe output.

## 10. Quantity Semantics

Quantity is first class on every normalized price.

```ts
type ProviderQuantity =
  | { min: number; max: number }
  | { min: number; max?: undefined };
```

Quantity constraints are optional in inputs but normalized on outputs.

There are two distinct default contexts:

**Create-time defaults** apply when a caller invokes `prices.create` without an explicit `quantity` field. The SDK encodes these into adapter-managed metadata at create time:

- Recurring/subscription price: `{ min: 1, max: 1 }`
- One-time price: `{ min: 1 }`

**Read-time fallback for unmanaged prices** applies when the SDK reads a price that has no `__provider_quantity_*` managed metadata — typically because the price was created outside the SDK (in the provider dashboard, by a seed script using the raw provider client, or by a different tool). The fallback is intentionally permissive:

- `{ min: 1, max: 999_999 }` regardless of kind

The unmanaged fallback is kind-agnostic on purpose. Claiming a tighter constraint on a price the SDK did not author would cause the SDK to pre-reject quantities the provider would otherwise accept, producing spurious `ProviderConstraintError` results. `999_999` matches Stripe's documented per-line-item maximum, so the SDK never claims more than the provider would actually accept.

Checkout defaults requested quantity to `quantity.min`. Adapters validate positive integer quantities against normalized quantity constraints. Stripe enables adjustable checkout quantity only when a finite `max` exists and the range is not the fixed `{1,1}`. Paddle receives a concrete quantity and must not leak Paddle-specific default ranges into normalized output.

Stripe stores explicit quantity constraints in adapter-managed metadata and reads them back into `ProviderPrice.quantity`. Paddle maps native quantity into the same normalized field only when the constraint is explicitly managed by the adapter or otherwise clearly configured by the caller.

Invalid managed quantity metadata is a normalization error. It must not silently clear or weaken constraints. Absent managed quantity metadata on a read is not an error — it triggers the unmanaged fallback.

## 11. Metadata Semantics

The SDK reserves a single adapter-managed metadata prefix. This document uses `__provider_*` as the chosen prefix; the actual string is fixed by the SDK and used consistently across all adapters.

Provider adapters write into this namespace and hide its keys from the normalized public `metadata` field on outputs. All metadata keys outside the reserved prefix are caller-controlled; adapters preserve them and round-trip them unchanged.

Reserved adapter-managed keys include at least:

- `__provider_quantity_min`
- `__provider_quantity_max`

If a caller passes metadata that uses the reserved prefix, the SDK throws a metadata collision error (`status: 422`) before any provider-native API call. Collision behavior must be documented and tested.

## 12. Checkout

Checkout creates hosted or provider-rendered checkout sessions from normalized line items.

Checkout line items reference provider price IDs and explicit quantities. The provider adapter owns provider-specific session creation, UI-mode fields, and provider SDK quirks. The normalized session result must not require HTTP or UI layers to know provider-specific field names.

Checkout supports discount application:

- a provider discount ID,
- a public discount code,
- or a provider-supported "allow promotion codes" style option when available.

Provider-specific limitations, such as only one checkout discount, must surface as normalized constraint errors.

## 13. Subscriptions

The subscription domain normalizes:

- list subscriptions for a customer,
- get a subscription,
- cancel immediately or at period end,
- change price and/or quantity immediately or at period end,
- cancel scheduled changes.

Pause and resume are intentionally removed from the normalized abstraction. Consumers needing provider-specific pause behavior must use the raw provider client.

Subscription quantity uses the same normalized quantity rules as checkout and prices.

## 14. Refunds

Refunds are deferred from the first SDK version. Providers may surface refunded or partially refunded purchase state and refund-related provider events, but the first public adapter contract does not expose refund read or issue methods.

Until the cross-provider refund contract is designed and conformance tested, refund flows should use provider-specific code paths outside the normalized `BillingProvider` interface.

## 15. Discounts

Discounts are planned as a full provider domain if conformance proves Stripe and Paddle models normalize cleanly.

Provider methods:

- `discounts.list(input?): Promise<Page<ProviderDiscount>>`
- `discounts.get(input): Promise<ProviderDiscount | null>`
- `discounts.create(input): Promise<ProviderDiscount>`
- `discounts.update(input): Promise<ProviderDiscount>`
- `discounts.archive(input): Promise<ProviderDiscount | null>`

The normalized model represents provider-neutral concepts:

- benefit: percent off or fixed amount off,
- public code or provider-only discount identity,
- active/archived status,
- expiration,
- redemption limits,
- product/price restrictions,
- recurring duration where supported.

Checkout discount application must work against the normalized discount model. If full lifecycle normalization proves too provider-specific, retain checkout discount normalization and defer lifecycle management.

## 16. Events and Webhooks

Real providers expose event polling and webhook handling.

Events normalize into stable envelopes with provider event ID, event type, resource identity, occurrence time, and optional translated domain payload. Webhook handling verifies signatures, extracts provider events, and translates supported events.

Price events normalize to a price-changed envelope and may additionally signal a product-changed envelope when provider state requires it.

Webhook endpoint management remains a provider domain. Provider implementation details such as metadata support, secret readback, or endpoint creation response shape stay inside adapter logic rather than capabilities.

## 17. Optional Domains

Optional domains are represented by object presence:

- `portal`: create customer billing portal sessions.
- `billingDocuments`: list normalized invoices, receipts, and credit notes.
- `paymentMethods`: list non-sensitive payment method summaries.

Optional domain briefs still define exact behavior for adapters that implement them.

## 18. Conformance and Test Briefs

The conformance suite is written from method-level test briefs that live in the repository.

Rules:

- Tests are black-box against the public provider SDK.
- Provider harnesses may perform provider-native setup, but assertions target normalized output only.
- No required-domain tests are skipped through capabilities.
- Optional-domain tests run only when the domain exists.
- Validation tests pass arbitrary invalid runtime values, including values typed as `any`, and assert normalized caller errors without provider-native API calls.
- Error tests assert that provider-native 404, 409, 429, authentication, and unavailable failures map to the normalized error contract.
- Briefs are living contract artifacts. Update the brief before changing conformance expectations.

The suite is organized into four tiers, each with a distinct setup contract:

1. **automated** — setup achievable through the SDK alone. Runs against every harness.
2. **self-setup** — gated on optional `harness.setup.*` capabilities (e.g. `createSubscription`, `completePurchase`) so harnesses that can self-provision state cover lifecycle scenarios automatically.
3. **semi-manual** — uses `harness.prompt(...)` to ask a developer to complete a non-reversible flow (e.g. paying a checkout session) and then resumes automated assertions. Gated on `INTERACTIVE=1`.
4. **fixture** — exercises pre-provisioned reusable resources declared on `harness.fixtures` (IDs the operator points at via env vars or runtime config). Each test asserts a clean starting state via a health-check, runs reversible operations, and reverts to clean state. Reduces manual burden by allowing reversible scenarios (cancel + uncancel, update + revert) to run unattended against any provider whose harness declares the fixtures, even when the SDK can't self-create the resource.

Per §5, every normalized response exposes an opt-in `raw?: TRaw` field. Conformance harnesses may implement `assertConsistency.<model>(output)` to independently verify, via the provider's native SDK, that the normalized output matches what the provider actually persisted. The conformance suite calls these hooks after every write so an adapter that fakes responses from in-memory state cannot pass conformance. Adapter packages may additionally maintain their own native test suites for behaviors outside the normalized contract (webhook emission timing, async settlement, provider-specific features); those are not conformance.

## 19. Build Order

1. Author this design document and method-level conformance briefs.
2. Create the SDK package with fully Typedoc-documented interfaces, Zod input schemas per method, and the normalized error class hierarchy.
3. Add SDK-level helper tests (model, validation, response, error helpers).
4. Implement the mock provider first and use it to harden the conformance suite.
5. Implement the Stripe provider.
6. Implement the Paddle provider.
7. Tighten conformance until all providers return identical normalized shapes except provider-native ID formats.

## 20. Open Questions

- Should discounts ship as a full lifecycle domain or only checkout discount normalization?
- Should refund issue methods support subscription invoices immediately or start with one-time purchases and payment references?
- What exact normalized event taxonomy should product, price, discount, and refund events use?
- Should provider methods primarily return API-style result envelopes, throw normalized errors, or support both with one canonical internal representation?
