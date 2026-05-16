<!-- AUTO-GENERATED STUB. Replace this file with handwritten prose, an example, and an errors list. The generator will not overwrite a file that lacks this comment. -->
---
title: checkout.createSession
domain: checkout
method: createSession
---

## Description

_TODO: handwrite a 1–2 paragraph description of what `checkout.createSession` does, when callers reach for it, and any gotchas._

## Request

See [`docs/openapi/checkout.json`](../../openapi/checkout.json) → operation `checkout.createSession` → `requestBody`.

## Response

See [`docs/openapi/checkout.json`](../../openapi/checkout.json) → operation `checkout.createSession` → response `200`.

## Capability Matrix

<!-- AUTO-GENERATED CAPABILITY MATRIX -->

Behavior of `checkout.createSession` by provider capability — pre-flight via `provider.capabilities`. When several capabilities affect this operation the rows together form the matrix to read for your provider's flags.

| Capability | true / present | false / absent |
| --- | --- | --- |
| `trialUnits` | `trial.unit` in the set is translated and passed to the provider. | `trial.unit` outside the set is rejected with `ProviderNotSupportedError` (422, feature `trial.unit`). |

## Errors

_TODO: list the normalized errors this method can throw and when._

## Example

_TODO: handwrite a runnable end-to-end snippet against the SDK._
