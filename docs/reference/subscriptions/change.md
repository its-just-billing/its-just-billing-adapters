<!-- AUTO-GENERATED STUB. Replace this file with handwritten prose, an example, and an errors list. The generator will not overwrite a file that lacks this comment. -->
---
title: subscriptions.change
domain: subscriptions
method: change
---

## Description

_TODO: handwrite a 1–2 paragraph description of what `subscriptions.change` does, when callers reach for it, and any gotchas._

## Request

See [`docs/openapi/subscriptions.json`](../../openapi/subscriptions.json) → operation `subscriptions.change` → `requestBody`.

## Response

See [`docs/openapi/subscriptions.json`](../../openapi/subscriptions.json) → operation `subscriptions.change` → response `200`.

## Capability Matrix

<!-- AUTO-GENERATED CAPABILITY MATRIX -->

Behavior of `subscriptions.change` by provider capability — pre-flight via `provider.capabilities`. When several capabilities affect this operation the rows together form the matrix to read for your provider's flags.

| Capability | true / present | false / absent |
| --- | --- | --- |
| `features.priceQuantityConstraints` | Item `quantity` is enforced against the price quantity constraint. | Item `quantity` is not enforced against the price constraint — consumer-owned (the price is still validated for existence and recurring kind). |

## Errors

_TODO: list the normalized errors this method can throw and when._

## Example

_TODO: handwrite a runnable end-to-end snippet against the SDK._
