<!-- AUTO-GENERATED STUB. Replace this file with handwritten prose, an example, and an errors list. The generator will not overwrite a file that lacks this comment. -->
---
title: prices.update
domain: prices
method: update
---

## Description

_TODO: handwrite a 1–2 paragraph description of what `prices.update` does, when callers reach for it, and any gotchas._

## Request

See [`docs/openapi/prices.json`](../../openapi/prices.json) → operation `prices.update` → `requestBody`.

## Response

See [`docs/openapi/prices.json`](../../openapi/prices.json) → operation `prices.update` → response `200`.

## Capability Matrix

<!-- AUTO-GENERATED CAPABILITY MATRIX -->

Behavior of `prices.update` by provider capability — pre-flight via `provider.capabilities`. When several capabilities affect this operation the rows together form the matrix to read for your provider's flags.

| Capability | true / present | false / absent |
| --- | --- | --- |
| `features.priceQuantityConstraints` | `quantity` constraint is enforced by the provider at checkout. | `quantity` is still persisted and round-trips, but is not enforced at checkout by the adapter. |

## Errors

_TODO: list the normalized errors this method can throw and when._

## Example

_TODO: handwrite a runnable end-to-end snippet against the SDK._
