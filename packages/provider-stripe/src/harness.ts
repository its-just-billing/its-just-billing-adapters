import type { ProviderTestHarness } from '@its-just-billing/provider-sdk/conformance';
import Stripe from 'stripe';
import {
  type StripeCheckoutPresentation,
  type StripeProvider,
  createStripeProvider,
} from './index.js';
import { normalizeStripeSubscription } from './normalize/subscription.js';

/**
 * Build a conformance harness for the Stripe adapter.
 *
 * Required environment:
 *   STRIPE_TEST_API_KEY                   — Stripe test-mode secret key.
 *
 * Fixture provisioning:
 *
 *   By default the harness seeds its own fixtures by creating real Stripe
 *   resources at construction time and tearing them down on `teardown()`.
 *   Stripe can self-create everything the fixture suite needs, so manual
 *   pre-provisioning is unnecessary — the env-var fixtures below exist only
 *   as an override for callers who want to pin against pre-existing
 *   resources (e.g. for repeatable debugging against a known account).
 *
 *   When an env var is set, it overrides the corresponding seeded id and the
 *   seeded resource is left in place but is not exposed to the suite.
 *
 *   STRIPE_FIXTURE_CUSTOMER_ID            — active customer, no caller metadata.
 *   STRIPE_FIXTURE_PRODUCT_ID             — active product, normalized tax category.
 *   STRIPE_FIXTURE_RECURRING_PRICE_ID     — active recurring price on the product
 *                                            (must be a DIFFERENT recurring price
 *                                            from the one the seeded subscription
 *                                            rides on — see SEEDED_FIXTURE_NOTES).
 *   STRIPE_FIXTURE_ONE_TIME_PRICE_ID      — active one-time price on the product.
 *   STRIPE_FIXTURE_SUBSCRIPTION_ID        — trialing subscription on a DIFFERENT
 *                                            recurring price than
 *                                            STRIPE_FIXTURE_RECURRING_PRICE_ID
 *                                            (price-change scenario short-circuits
 *                                            when sub is already on the swap target).
 *   STRIPE_FIXTURE_DISCOUNT_ID            — active promotion code id (Stripe
 *                                            `promo_...`).
 *   STRIPE_FIXTURE_WEBHOOK_ENDPOINT_ID    — active webhook endpoint.
 */
export type StripeHarness = ProviderTestHarness<StripeCheckoutPresentation> & {
  provider: StripeProvider;
};

export interface CreateStripeHarnessOptions {
  /** Override the API key (defaults to `process.env.STRIPE_TEST_API_KEY`). */
  apiKey?: string;
  /**
   * Whether to provision fixtures by creating real Stripe resources at
   * construction time. Defaults to `false`; set to `true` from the fixture
   * spec file so the fixture conformance suite has everything it needs.
   */
  seedFixtures?: boolean;
}

/**
 * Construct a fresh Stripe conformance harness. Async because seeding the
 * fixture resources requires network calls; the SDK runner accepts a
 * `Promise<ProviderTestHarness>` from the factory.
 */
export async function createStripeHarness(
  options: CreateStripeHarnessOptions = {},
): Promise<StripeHarness> {
  const apiKey = options.apiKey ?? process.env.STRIPE_TEST_API_KEY;
  if (!apiKey) {
    throw new Error(
      'STRIPE_TEST_API_KEY env var is required to run the Stripe conformance suite. ' +
        'Set it to a Stripe test-mode secret key (sk_test_...).',
    );
  }
  const stripe = new Stripe(apiKey);
  const provider = createStripeProvider({ apiKey, client: stripe });

  let seeded: SeededFixtures | undefined;
  if (options.seedFixtures) {
    seeded = await seedAllFixtures(stripe);
  }
  // Env vars override seeded ids when set; this is the "pin to existing
  // resources" path.
  const fixtures = mergeFixtures(seeded, readFixturesFromEnv());

  return {
    label: 'stripe',
    provider,
    setup: {
      async createSubscription({ customerId, priceId, quantity = 1 }) {
        // Use a trial so the resulting subscription lands in `status='trialing'`
        // without needing a payment method or invoice settlement. Stripe
        // blocks invoice-affecting mutations on `incomplete` subs (which is
        // what `payment_behavior: 'default_incomplete'` produces), so a
        // trialing sub is what the conformance change/cancel tests actually
        // need.
        const native = await stripe.subscriptions.create({
          customer: customerId,
          items: [{ price: priceId, quantity }],
          trial_period_days: 365,
        });
        return normalizeStripeSubscription(native);
      },
      // completePurchase: Stripe has no public "complete this checkout
      // session" API. Leaving it undefined means the semi-manual + self-setup
      // purchase tests skip cleanly.
    },
    ...(Object.keys(fixtures).length > 0 ? { fixtures } : {}),
    assertConsistency: {
      async customer(output) {
        const native = await stripe.customers.retrieve(output.id);
        // Stripe's archive (`customers.del`) is "delete + still retrievable
        // as DeletedCustomer". From the SDK contract's perspective that IS
        // the archived state — the customer is no longer active. The native
        // DeletedCustomer payload has no email/name to compare, so accept
        // it as consistent (the caller-facing snapshot from archive() is
        // what's authoritative, not Stripe's deletion echo).
        if ('deleted' in native && native.deleted) return;
        if (native.email !== output.email) {
          throw new Error(
            `consistency: customer ${output.id} email mismatch (native=${native.email}, normalized=${output.email})`,
          );
        }
        if ((native.name ?? null) !== output.name) {
          throw new Error(
            `consistency: customer ${output.id} name mismatch (native=${native.name}, normalized=${output.name})`,
          );
        }
      },
      async product(output) {
        const native = await stripe.products.retrieve(output.id);
        if ('deleted' in native && native.deleted) {
          throw new Error(`consistency: product ${output.id} is deleted natively`);
        }
        if (native.active !== output.active) {
          throw new Error(
            `consistency: product ${output.id} active mismatch (native=${native.active}, normalized=${output.active})`,
          );
        }
        if (native.name !== output.name) {
          throw new Error(
            `consistency: product ${output.id} name mismatch (native=${native.name}, normalized=${output.name})`,
          );
        }
      },
      async price(output) {
        const native = await stripe.prices.retrieve(output.id);
        if (native.active !== output.active) {
          throw new Error(
            `consistency: price ${output.id} active mismatch (native=${native.active}, normalized=${output.active})`,
          );
        }
        if (native.unit_amount !== output.unitAmount) {
          throw new Error(
            `consistency: price ${output.id} unit_amount mismatch (native=${native.unit_amount}, normalized=${output.unitAmount})`,
          );
        }
      },
      async subscription(output) {
        const native = await stripe.subscriptions.retrieve(output.id);
        if (native.cancel_at_period_end !== output.cancelAtPeriodEnd) {
          throw new Error(
            `consistency: subscription ${output.id} cancelAtPeriodEnd mismatch (native=${native.cancel_at_period_end}, normalized=${output.cancelAtPeriodEnd})`,
          );
        }
        if (native.items.data.length !== output.items.length) {
          throw new Error(
            `consistency: subscription ${output.id} item count mismatch (native=${native.items.data.length}, normalized=${output.items.length})`,
          );
        }
      },
      async discount(output) {
        const native = await stripe.promotionCodes.retrieve(output.id);
        if (native.active !== output.active) {
          throw new Error(
            `consistency: discount ${output.id} active mismatch (native=${native.active}, normalized=${output.active})`,
          );
        }
        // The normalizer surfaces `code: null` for promotion codes the caller
        // didn't explicitly name (Stripe always auto-generates a code in
        // that case). Native will have the auto-generated value; treat that
        // as consistent, not a mismatch.
        if (output.code !== null && native.code !== output.code) {
          throw new Error(
            `consistency: discount ${output.id} code mismatch (native=${native.code}, normalized=${output.code})`,
          );
        }
      },
      async webhookEndpoint(output) {
        const native = await stripe.webhookEndpoints.retrieve(output.id);
        const nativeActive = native.status === 'enabled';
        if (nativeActive !== output.active) {
          throw new Error(
            `consistency: webhook endpoint ${output.id} active mismatch (native=${nativeActive}, normalized=${output.active})`,
          );
        }
        if (native.url !== output.url) {
          throw new Error(
            `consistency: webhook endpoint ${output.id} url mismatch (native=${native.url}, normalized=${output.url})`,
          );
        }
      },
    },
    async cleanupResource(kind, id) {
      // Best-effort hard-delete. Each conformance suite calls this in
      // `afterAll` before falling back to the contract's soft-delete; if we
      // can clear the resource here, the test account doesn't accumulate
      // archived residue across runs. Failures propagate (the suite swallows
      // them), but we deliberately throw rather than no-op when Stripe
      // refuses — that's information the suite uses to decide whether to
      // fall through.
      switch (kind) {
        case 'product':
          // Stripe rejects `products.del` when any prices are attached
          // (active or archived). The conformance afterAll loops are
          // ordered prices-first, so when this runs the product is
          // typically price-free and deletes cleanly.
          await stripe.products.del(id);
          return;
        case 'discount': {
          // ProviderDiscount.id is a Stripe PromotionCode id. Stripe doesn't
          // expose a `del` on PromotionCode, but deleting the underlying
          // Coupon cascades to drop the promotion code. Resolve the coupon
          // first; if the promotion code is already gone we're already in
          // the goal state.
          let promo: Stripe.PromotionCode;
          try {
            promo = await stripe.promotionCodes.retrieve(id);
          } catch {
            return;
          }
          const couponId =
            typeof promo.coupon === 'string' ? promo.coupon : promo.coupon.id;
          await stripe.coupons.del(couponId);
          return;
        }
        case 'customer':
          // `archive` already calls `customers.del` natively, so the
          // contract path is the hard-delete. Falling through to that is
          // sufficient; no extra work here.
          return;
        case 'price':
        case 'subscription':
        case 'checkoutSession':
        case 'webhookEndpoint':
          // Prices and checkout sessions can never be deleted on Stripe;
          // subscriptions can only be canceled (which `subscriptions.cancel`
          // does). Webhook endpoints are hard-deleted via the contract
          // method (`webhooks.deleteEndpoint`). No extra cleanup needed.
          return;
      }
    },
    async teardown() {
      if (seeded) await teardownSeededFixtures(stripe, seeded);
    },
  };
}

/**
 * Bundle of ids produced by {@link seedAllFixtures}. Internal state used at
 * teardown to drive cleanup; not the same shape as the SDK's
 * `ProviderTestFixtures` since this also tracks the underlying coupon id
 * (PromotionCode references a Coupon and we need to delete the Coupon to
 * cascade) and the subscription's price (which is intentionally different
 * from the swap-target `recurringPriceId`).
 */
interface SeededFixtures {
  customerId: string;
  productId: string;
  recurringPriceId: string;
  subscriptionPriceId: string;
  oneTimePriceId: string;
  subscriptionId: string;
  discountId: string;
  couponId: string;
  webhookEndpointId: string;
}

async function seedAllFixtures(stripe: Stripe): Promise<SeededFixtures> {
  const tag = `conformance-${Date.now().toString(36)}`;

  const customer = await stripe.customers.create({
    email: `fixture+${tag}@stripe.adapter.test`,
    name: 'Stripe Conformance Fixture',
  });

  const product = await stripe.products.create({
    name: `fixture-product-${tag}`,
    // Aligned with the SDK's TaxCategory enum via TAX_CATEGORY_TO_STRIPE.saas.
    tax_code: 'txcd_10103000',
    // The fixture-suite combined name+description scenario requires a
    // non-null starting description so its revert step can restore it; the
    // SDK contract makes description immutable-once-set.
    description: 'conformance-fixture seed description',
  });

  // Two recurring prices on the same product:
  //   recurringPriceId: the swap-target exposed to fixture tests.
  //   subscriptionPriceId: what the seeded subscription rides on.
  // They MUST differ — the price-change fixture scenario short-circuits when
  // the subscription is already on the swap target.
  const recurringPrice = await stripe.prices.create({
    product: product.id,
    currency: 'usd',
    unit_amount: 999,
    recurring: { interval: 'month' },
  });
  const subscriptionPrice = await stripe.prices.create({
    product: product.id,
    currency: 'usd',
    unit_amount: 1499,
    recurring: { interval: 'month' },
  });
  const oneTimePrice = await stripe.prices.create({
    product: product.id,
    currency: 'usd',
    unit_amount: 4999,
  });

  // Subscriptions need to be 'active' or 'trialing' per the fixture-suite
  // contract. A trial keeps us in 'trialing' without provisioning a payment
  // method; the trial window outlives any test run.
  const subscription = await stripe.subscriptions.create({
    customer: customer.id,
    items: [{ price: subscriptionPrice.id }],
    trial_period_days: 365,
  });

  // Coupon + PromotionCode pair, matching the adapter's discounts model.
  const coupon = await stripe.coupons.create({
    percent_off: 10,
    duration: 'once',
  });
  const promo = await stripe.promotionCodes.create({ coupon: coupon.id });

  const webhook = await stripe.webhookEndpoints.create({
    url: `https://example.com/hook-fixture-${tag}`,
    enabled_events: ['customer.created', 'customer.subscription.updated'],
  });

  return {
    customerId: customer.id,
    productId: product.id,
    recurringPriceId: recurringPrice.id,
    subscriptionPriceId: subscriptionPrice.id,
    oneTimePriceId: oneTimePrice.id,
    subscriptionId: subscription.id,
    discountId: promo.id,
    couponId: coupon.id,
    webhookEndpointId: webhook.id,
  };
}

async function teardownSeededFixtures(stripe: Stripe, seeded: SeededFixtures): Promise<void> {
  // Best-effort cleanup. Every step is independent — failures are swallowed
  // so partial teardown still progresses the rest. Test mode forgives the
  // odd orphan; the goal is to keep the account uncluttered between runs.
  await safe(() => stripe.subscriptions.cancel(seeded.subscriptionId));
  await safe(() => stripe.webhookEndpoints.del(seeded.webhookEndpointId));
  // Deleting the coupon cascades to its promotion codes; the discount id
  // (promo) does not need a separate delete call.
  await safe(() => stripe.coupons.del(seeded.couponId));
  // Stripe forbids deleting prices that have ever been used (and our
  // subscription used the recurring one); deactivate instead.
  await safe(() => stripe.prices.update(seeded.recurringPriceId, { active: false }));
  await safe(() => stripe.prices.update(seeded.subscriptionPriceId, { active: false }));
  await safe(() => stripe.prices.update(seeded.oneTimePriceId, { active: false }));
  // Products with prices cannot be deleted; archive instead.
  await safe(() => stripe.products.update(seeded.productId, { active: false }));
  await safe(() => stripe.customers.del(seeded.customerId));
}

async function safe(fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch {
    // teardown is best-effort
  }
}

function mergeFixtures(
  seeded: SeededFixtures | undefined,
  override: NonNullable<StripeHarness['fixtures']>,
): NonNullable<StripeHarness['fixtures']> {
  const base: NonNullable<StripeHarness['fixtures']> = {};
  if (seeded) {
    base.customerId = seeded.customerId;
    base.productId = seeded.productId;
    base.recurringPriceId = seeded.recurringPriceId;
    base.oneTimePriceId = seeded.oneTimePriceId;
    base.subscriptionId = seeded.subscriptionId;
    base.discountId = seeded.discountId;
    base.webhookEndpointId = seeded.webhookEndpointId;
  }
  return { ...base, ...override };
}

function readFixturesFromEnv() {
  const out: NonNullable<StripeHarness['fixtures']> = {};
  const env = process.env;
  if (env.STRIPE_FIXTURE_CUSTOMER_ID) out.customerId = env.STRIPE_FIXTURE_CUSTOMER_ID;
  if (env.STRIPE_FIXTURE_PRODUCT_ID) out.productId = env.STRIPE_FIXTURE_PRODUCT_ID;
  if (env.STRIPE_FIXTURE_RECURRING_PRICE_ID) {
    out.recurringPriceId = env.STRIPE_FIXTURE_RECURRING_PRICE_ID;
  }
  if (env.STRIPE_FIXTURE_ONE_TIME_PRICE_ID) {
    out.oneTimePriceId = env.STRIPE_FIXTURE_ONE_TIME_PRICE_ID;
  }
  if (env.STRIPE_FIXTURE_SUBSCRIPTION_ID) out.subscriptionId = env.STRIPE_FIXTURE_SUBSCRIPTION_ID;
  if (env.STRIPE_FIXTURE_DISCOUNT_ID) out.discountId = env.STRIPE_FIXTURE_DISCOUNT_ID;
  if (env.STRIPE_FIXTURE_WEBHOOK_ENDPOINT_ID) {
    out.webhookEndpointId = env.STRIPE_FIXTURE_WEBHOOK_ENDPOINT_ID;
  }
  return out;
}
