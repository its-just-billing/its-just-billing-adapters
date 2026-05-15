---
title: Conformance test process — the two-agent pipeline
---

# Tests-from-briefs runbook

Conformance tests must be written **implementation-unaware**: the code that decides what to assert never sees the code under test. This protects the contract — if a provider adapter and its tests share assumptions, the suite stops being a conformance gate and becomes a regression suite.

We achieve this with a two-agent pipeline. Briefs are ephemeral artifacts (not committed); test code is committed.

## When to run this process

- A new method is added to the SDK contract.
- An existing method's behavior changes in `provider-system-v2.md` or in its Zod schemas.
- A bug is found in conformance that traces back to a missed scenario in the brief.

## Step 1 — Brief agent

Spawn an Agent with input strictly limited to the **contract surface**:

```
- packages/provider-sdk/src/billing-provider.ts
- packages/provider-sdk/src/domains/<domain>.ts
- packages/provider-sdk/src/schemas/<domain>/<method>.ts (input + output schema)
- packages/provider-sdk/src/models/*.ts (referenced models)
- packages/provider-sdk/src/errors/*.ts
- packages/provider-sdk/src/conformance/harness.ts (so it knows what setup capabilities exist)
- provider-system-v2.md (relevant section, e.g. §9 Products, §10 Quantity)
- docs/reference/<domain>/<method>.md (if handwritten)
```

The agent's job: produce a plain-English brief describing every behavior a conforming implementation must exhibit.

### Brief template (the agent fills this in)

```md
# Brief: <domain>.<method>

## What it does
One paragraph describing the method's purpose from the caller's perspective.

## Inputs
For every field in the input schema: name, type, whether required, validation rules.

## Outputs
For every field in the output schema: name, type, semantics, nullability.

## Happy path
The exact sequence of provider state and assertions a conforming implementation must satisfy for a typical input.

## Validation cases (must throw ProviderValidationError, 400, before any provider call)
- empty required string
- non-string where a string is required
- malformed email / URL / currency
- negative or fractional integer where a positive integer is required
- ...
(One bullet per distinct validation rule.)

## Constraint and conflict cases
- metadata containing a reserved __provider_* key → MetadataCollisionError (422)
- price update attempting to change immutable field → ProviderConstraintError (422)
- duplicate resource → ProviderConflictError (409)
- ...

## Provider-mapped errors
- provider 404 → ProviderNotFoundError (404)
- provider 401/403 → ProviderAuthError
- provider 429 → ProviderRateLimitError, optional retryAfterSeconds
- provider 5xx / transport failure → ProviderUnavailableError
- malformed normalized state from provider → ProviderNormalizationError

## Black-box invariants
- Idempotency expectations.
- Round-trip expectations (e.g. metadata round-trips, reserved keys never appear on output).
- Date semantics (UTC, JS Date instances).
- Sort order expectations for list outputs.

## Setup requirements per suite
- **automated**: list the prerequisites achievable through the SDK alone (e.g. "create a customer first").
- **self-setup**: list anything that needs `harness.setup.X` (e.g. "harness.setup.createSubscription required for cancel tests").
- **semi-manual**: list anything that requires a developer prompt (e.g. "prompt the dev to complete a Paddle checkout in the browser").
- **fixture**: list any scenario that fits the reusable-resource pattern — a pre-provisioned resource (declared on `harness.fixtures.<id>`) that the test can health-check, exercise via reversible operations, and revert to a clean starting state. Skip create / hard-delete paths here; they belong in other tiers. For each fixture scenario, describe the expected clean starting state (the `healthCheck`) and the revert path. Test code uses the `withFixture(key, { healthCheck, test, revert })` helper exported from `@its-just-billing/provider-sdk/conformance`.

## Consistency hooks
After every successful write assertion, the test code must call the matching `harness.assertConsistency?.<model>?.(result)` hook. The brief does not need to enumerate the hook calls — they follow mechanically — but the brief MUST identify which assertions are writes (`create`, `update`, `cancel`, `change`, `deactivate`, `activate`, `cancelScheduledChange`, etc.) so the test agent knows where to insert the calls. Reads (`get`, `list`) do not get a consistency hook.
```

## Step 2 — Test agent

Spawn a second Agent with input strictly limited to:

- The brief from step 1 (passed inline in the prompt — not a file the agent can read).
- `packages/provider-sdk/src/billing-provider.ts`
- `packages/provider-sdk/src/domains/<domain>.ts`
- `packages/provider-sdk/src/conformance/harness.ts`
- `packages/provider-sdk/src/conformance/suites/<suite>/index.ts` (to see how existing per-domain spec files are wired in)
- Public type exports from `@its-just-billing/provider-sdk`.

The agent must NOT have read access to:

- `packages/provider-mock/**`
- `packages/provider-stripe/**`
- `packages/provider-paddle/**`
- Any provider adapter source.

The agent's job: produce TypeScript test code under
`packages/provider-sdk/src/conformance/suites/<suite>/<domain>.ts` that, for each scenario in the brief:

- categorizes the scenario into the correct suite (automated / self-setup / semi-manual);
- registers a `describe(...)` block per scenario group inside the suite's exported registration function;
- uses `it(...)` per assertion;
- references only the public SDK type surface;
- skips a self-setup case with `it.skipIf(!harness.setup?.X)(...)` when the required capability is absent.

## Step 3 — Human review

The committer (you) reviews the generated test code, runs `pnpm --filter @its-just-billing/provider-sdk check:conformance-purity`, and commits. The brief is discarded.

## Step 4 — Optional: codify as slash command

Once the runbook is stable, wrap the two Agent invocations as a `/generate-conformance <domain> <method>` slash command. The command runs step 1, captures the brief in an in-memory string, and feeds it to step 2 — never writing the brief to disk. This is out of scope for the initial setup; the runbook is the contract.

## The purity guard

`packages/provider-sdk/scripts/check-conformance-purity.ts` greps everything under `src/conformance/` for imports of `@its-just-billing/provider-mock`, `provider-stripe`, or `provider-paddle`. If any are found, the script fails non-zero. Wire it into CI alongside `pnpm test`.
