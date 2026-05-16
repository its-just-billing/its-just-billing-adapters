<!-- AUTO-GENERATED STUB. Replace this file with handwritten prose, an example, and an errors list. The generator will not overwrite a file that lacks this comment. -->
---
title: discounts.create
domain: discounts
method: create
---

## Description

_TODO: handwrite a 1–2 paragraph description of what `discounts.create` does, when callers reach for it, and any gotchas._

## Request

See [`docs/openapi/discounts.json`](../../openapi/discounts.json) → operation `discounts.create` → `requestBody`.

## Response

See [`docs/openapi/discounts.json`](../../openapi/discounts.json) → operation `discounts.create` → response `200`.

## Capability Matrix

<!-- AUTO-GENERATED CAPABILITY MATRIX -->

Behavior of `discounts.create` by provider capability — pre-flight via `provider.capabilities`. When several capabilities affect this operation the rows together form the matrix to read for your provider's flags.

| Capability | true / present | false / absent |
| --- | --- | --- |
| `features.discountProductRestrictions` | `restrictedTo.productIds` is enforced natively by the provider (e.g. Stripe `coupon.applies_to.products`), with no extra round-trips; product ids that do not exist are rejected by the provider. | `restrictedTo.productIds` round-trips faithfully but is not enforced by the adapter — the consumer enforces it from its own persistence. |
| `features.discountPriceRestrictions` | `restrictedTo.priceIds` is enforced natively by the provider. | `restrictedTo.priceIds` round-trips faithfully (no native price-scoped mechanism) but is not enforced by the adapter — the consumer enforces it from its own persistence. |

## Errors

_TODO: list the normalized errors this method can throw and when._

## Example

_TODO: handwrite a runnable end-to-end snippet against the SDK._
