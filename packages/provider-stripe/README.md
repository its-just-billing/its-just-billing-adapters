# @its-just-billing/provider-stripe

Stripe adapter for the its-just-billing provider SDK.

## Running the conformance suites

All Stripe conformance specs require a **test-mode** secret key:

```sh
STRIPE_TEST_API_KEY=sk_test_... pnpm --filter @its-just-billing/provider-stripe test
```

Without the key the `automated`, `self-setup`, and `fixture` specs skip.

## Fixture conformance suite

The `fixture` suite is **subscriptions-only**. A subscription is the single
resource the public SDK cannot bootstrap (creating one requires a
checkout/payment the SDK doesn't drive), so it is the only thing worth
pre-provisioning. Every other resource — products, prices, customers,
discounts, webhook endpoints — is SDK-creatable, so those flows are exercised
by the **automated** and **self-setup** suites with resources created at test
time and archived afterward. There are no product/price/customer/discount/
webhook fixture domains.

### Stripe needs no fixture file

Stripe's harness exposes `setup.createSubscription` (it attaches a test card
and creates a real subscription at runtime), so Stripe's subscription
lifecycle is covered by the **self-setup** suite. The fixture subscription
tests therefore **skip for Stripe** — `createStripeHarness({ fixtures: true })`
resolves no subscription and `harness.fixtures` is `undefined`.

An optional pin exists only for debugging against a specific long-lived
subscription:

1. `STRIPE_FIXTURE_SUBSCRIPTION_ID` env var, else
2. a `{ "subscriptionId": "sub_..." }` in
   `packages/provider-stripe/fixture-resources.json` (only if you choose to
   create one — it is not committed and not auto-generated), else
3. nothing → fixture subscription tests skip.

There is **no seeding, no teardown, and no self-heal** — the only thing this
path can carry is one subscription id.

### Providers that can't self-create a subscription

Paddle/Polar (hosted-checkout only — no programmatic subscription create)
hand-provision one subscription and commit a `fixture-resources.json` in their
own package:

```json
{ "subscriptionId": "<provider subscription id>" }
```

Constraints on that subscription (the fixture suite health-checks them and
reverts any change it makes):

- status `active` or `trialing`, `cancelAtPeriodEnd: false`, no pending change,
  **exactly one item**.

The price-change scenario creates its own swap-target product+price at test
time (mirroring the subscription's current price), so there is no second-price
constraint and no other ids to provision. If `subscriptionId` is absent the
suite simply skips (`lazySkipIf`) and stays green.
