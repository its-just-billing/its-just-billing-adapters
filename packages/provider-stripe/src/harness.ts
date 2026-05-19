import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type ProviderTestHarness,
  readlinePrompt,
} from '@its-just-billing/provider-sdk/conformance';
import Stripe from 'stripe';
import {
  type StripeCheckoutPresentation,
  type StripeProvider,
  createStripeProvider,
} from './index.js';
import { normalizeStripeSubscription } from './normalize/subscription.js';
import { trialToStripeDays } from './trial-translation.js';

/**
 * Build a conformance harness for the Stripe adapter.
 *
 * Required environment:
 *   STRIPE_TEST_API_KEY                   — Stripe test-mode secret key.
 *
 * Fixture provisioning (only when `options.fixtures` is true):
 *
 *   The fixture suite's only pre-provisioned resource is a subscription — the
 *   one thing the public SDK can't bootstrap (it needs a checkout/payment).
 *   Stripe normally does NOT supply one: `setup.createSubscription` attaches a
 *   test card and creates a real subscription at runtime, so Stripe's
 *   subscription lifecycle is covered by the self-setup suite and the fixture
 *   subscription tests skip.
 *
 *   The override below exists only for pinning against a specific long-lived
 *   Stripe subscription (repeatable debugging). Resolution order:
 *
 *     1. `STRIPE_FIXTURE_SUBSCRIPTION_ID` env var, else
 *     2. a `subscriptionId` field in `fixture-resources.json` at the package
 *        root (only if you choose to commit one), else
 *     3. nothing → `harness.fixtures` is undefined → fixture suite skips.
 *
 *   There is no seeding, no teardown, and no other resource: products,
 *   prices, customers, discounts and webhook endpoints are created at test
 *   time by the automated/self-setup suites.
 */
export type StripeHarness = ProviderTestHarness<StripeCheckoutPresentation> & {
  provider: StripeProvider;
};

export interface CreateStripeHarnessOptions {
  /** Override the API key (defaults to `process.env.STRIPE_TEST_API_KEY`). */
  apiKey?: string;
  /**
   * Whether this harness backs the fixture conformance suite. When `true`,
   * the harness resolves an optional pinned `subscriptionId` (env → config
   * file). Defaults to `false`; the automated/self-setup specs leave it unset
   * so they do zero config IO and expose no `fixtures`.
   */
  fixtures?: boolean;
  /**
   * Override the path to the optional subscription-pin config file.
   * Defaults to `fixture-resources.json` at the provider-stripe package root.
   */
  fixtureConfigPath?: string;
}

/** The single pinnable fixture id — matches the SDK `ProviderTestFixtures`. */
type FixtureConfig = Required<NonNullable<StripeHarness['fixtures']>>;

function defaultFixtureConfigPath(): string {
  // From src/harness.ts (vitest runs the TS source) or dist/harness.js, the
  // parent of the module dir is the package root either way.
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', 'fixture-resources.json');
}

/**
 * Attach Stripe's canonical test card (`tok_visa` → 4242 4242 4242 4242,
 * always succeeds in test mode) to a customer and make it the default for
 * invoices. This lets `stripe.subscriptions.create` settle the first invoice
 * synchronously so the subscription lands `active` — the realistic
 * "signed up with a card" flow.
 *
 * Without a default payment method (and no trial) Stripe creates the
 * subscription in `incomplete` status and then blocks the invoice-affecting
 * mutations (`change`, `cancel`, `cancelScheduledChange`) the conformance
 * suite exercises. We use a real test card rather than the old
 * `trial_period_days: 365` trick so the harness mirrors production behavior
 * instead of leaning on a year-long trial as a side effect.
 */
async function attachTestPaymentMethod(stripe: Stripe, customerId: string): Promise<void> {
  const pm = await stripe.paymentMethods.create({
    type: 'card',
    card: { token: 'tok_visa' },
  });
  await stripe.paymentMethods.attach(pm.id, { customer: customerId });
  await stripe.customers.update(customerId, {
    invoice_settings: { default_payment_method: pm.id },
  });
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

  const fixtures = options.fixtures
    ? resolveFixtures(options.fixtureConfigPath ?? defaultFixtureConfigPath())
    : undefined;

  return {
    label: 'stripe',
    provider,
    // Presence of `prompt` is the semi-manual opt-in signal. `readlinePrompt`
    // is only used as the non-TTY line-mode fallback path; the interactive
    // "press O to open" UX is owned by the SDK's `awaitManualStep`.
    prompt: readlinePrompt,
    checkoutUrl: (presentation) =>
      presentation.kind === 'stripe_hosted' ? presentation.url : null,
    setup: {
      async createSubscription({ customerId, priceId, quantity = 1, trial }) {
        // Realistic flow: attach a test card and let Stripe settle the first
        // invoice so the subscription lands `active` (or `trialing` when a
        // trial is requested). Both states are mutable, which the conformance
        // change/cancel tests need; `incomplete` (no card, no trial) is not.
        await attachTestPaymentMethod(stripe, customerId);

        // When the caller passes `trial` explicitly, honor it exactly — same
        // semantics as `checkout.createSession`. Stripe's `trial_period_days`
        // only accepts day-level trials, so month/year units have no fixed-
        // day equivalent and surface as ProviderNotSupportedError (via
        // `trialToStripeDays`) rather than a silent approximation. When no
        // trial is passed, none is set — matching the public API.
        const trialDays = trial !== undefined ? trialToStripeDays(trial) : undefined;
        const native = await stripe.subscriptions.create({
          customer: customerId,
          items: [{ price: priceId, quantity }],
          // Fail loudly if the first invoice can't settle synchronously
          // rather than returning a silently-incomplete sub that later
          // mutation tests would fail against confusingly.
          payment_behavior: 'error_if_incomplete',
          ...(trialDays !== undefined ? { trial_period_days: trialDays } : {}),
        });
        return normalizeStripeSubscription(native);
      },
      // completePayment: Stripe has no public "complete this checkout
      // session" API. Leaving it undefined means the semi-manual + self-setup
      // payment tests skip cleanly.
    },
    ...(fixtures ? { fixtures } : {}),
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
          const couponId = typeof promo.coupon === 'string' ? promo.coupon : promo.coupon.id;
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
    // No `teardown`: the fixture suite's only resource is an optional pinned
    // subscription that is never created or destroyed here. Scaffolding the
    // automated/self-setup suites create is archived by those suites.
  };
}

/**
 * Resolve an optional pinned subscription id for the fixture suite.
 *
 * Stripe normally returns `undefined` here (no env, no file) so the fixture
 * subscription tests skip — Stripe's subscription lifecycle is covered by the
 * self-setup suite via `setup.createSubscription`. The env/file override
 * exists only to pin a specific long-lived subscription for debugging. There
 * is no seeding and no other resource.
 */
function resolveFixtures(configPath: string): FixtureConfig | undefined {
  const fromEnv = process.env.STRIPE_FIXTURE_SUBSCRIPTION_ID;
  if (fromEnv) return { subscriptionId: fromEnv };

  if (!existsSync(configPath)) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(configPath, 'utf8'));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Fixture config "${configPath}" is not valid JSON (${message}). Fix it, or delete it.`,
    );
  }
  const subscriptionId =
    typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>).subscriptionId
      : undefined;
  if (typeof subscriptionId === 'string' && subscriptionId.length > 0) {
    return { subscriptionId };
  }
  // A file with no usable subscriptionId is treated as "no pin" rather than
  // an error — the only thing this file may carry now is a subscription id.
  return undefined;
}
