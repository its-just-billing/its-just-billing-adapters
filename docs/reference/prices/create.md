<!-- AUTO-GENERATED STUB. Replace this file with handwritten prose, an example, and an errors list. The generator will not overwrite a file that lacks this comment. -->
---
title: prices.create
domain: prices
method: create
---

## Description

_TODO: handwrite a 1–2 paragraph description of what `prices.create` does, when callers reach for it, and any gotchas._

## Request

See [`docs/openapi/prices.json`](../../openapi/prices.json) → operation `prices.create` → `requestBody`.

## Response

See [`docs/openapi/prices.json`](../../openapi/prices.json) → operation `prices.create` → response `200`.

## Capability Matrix

<!-- AUTO-GENERATED CAPABILITY MATRIX -->

Behavior of `prices.create` by provider capability — pre-flight via `provider.capabilities`. When several capabilities affect this operation the rows together form the matrix to read for your provider's flags.

| Capability | true / present | false / absent |
| --- | --- | --- |
| `features.priceQuantityConstraints` | `quantity` constraint is enforced by the provider at checkout. | `quantity` is still persisted on the price and round-trips, but the adapter does not enforce it at checkout — the consumer enforces it from its own persistence. |
| `features.priceLevelRecurrence` | Recurring price `kind` accepted; recurrence lives on the price. | Recurring price `kind` rejected; recurrence lives on the product (`products.create` `recurrence`). |

## Errors

_TODO: list the normalized errors this method can throw and when._

## Example

_TODO: handwrite a runnable end-to-end snippet against the SDK._
