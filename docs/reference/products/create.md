<!-- AUTO-GENERATED STUB. Replace this file with handwritten prose, an example, and an errors list. The generator will not overwrite a file that lacks this comment. -->
---
title: products.create
domain: products
method: create
---

## Description

_TODO: handwrite a 1–2 paragraph description of what `products.create` does, when callers reach for it, and any gotchas._

## Request

See [`docs/openapi/products.json`](../../openapi/products.json) → operation `products.create` → `requestBody`.

## Response

See [`docs/openapi/products.json`](../../openapi/products.json) → operation `products.create` → response `200`.

## Capability Matrix

<!-- AUTO-GENERATED CAPABILITY MATRIX -->

Behavior of `products.create` by provider capability — pre-flight via `provider.capabilities`. When several capabilities affect this operation the rows together form the matrix to read for your provider's flags.

| Capability | true / present | false / absent |
| --- | --- | --- |
| `features.productLevelRecurrence` | `recurrence` block accepted and stored on the product. | `recurrence` rejected with `ProviderNotSupportedError` (422, `not_supported`, feature `product.recurrence`). Recurrence lives on the price instead. |

## Errors

_TODO: list the normalized errors this method can throw and when._

## Example

_TODO: handwrite a runnable end-to-end snippet against the SDK._
