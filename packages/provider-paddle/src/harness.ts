import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type ProviderTestHarness,
  readlinePrompt,
} from '@its-just-billing/provider-sdk/conformance';
import { Environment, Paddle } from '@paddle/paddle-node-sdk';
import {
  type PaddleCheckoutPresentation,
  type PaddleProvider,
  createPaddleProvider,
} from './index.js';
import { wrapPaddleWithRateLimiting } from './rate-limit.js';

/**
 * Build a conformance harness for the Paddle adapter.
 *
 * Required environment:
 *   PADDLE_TEST_API_KEY  — a Paddle **sandbox** API key (`pdl_sdbx_...`).
 *
 * Unlike Stripe, Paddle cannot bootstrap a subscription via the API — a
 * subscription is only born from a completed checkout/transaction the SDK
 * doesn't drive. So this harness exposes **no** `setup.createSubscription`
 * and **no** `setup.completePayment`:
 *
 *   - subscription lifecycle is covered by the **fixture** suite against a
 *     hand-provisioned long-lived subscription, and
 *   - the payment lifecycle is covered by the **semi-manual** suite (the dev
 *     completes a hosted checkout; `checkoutUrl` + the "press O to open"
 *     shortcut make that one click).
 *
 * Fixture provisioning (only when `options.fixtures` is true). Resolution:
 *   1. `PADDLE_FIXTURE_SUBSCRIPTION_ID` env var, else
 *   2. a `{ "subscriptionId": "sub_..." }` in `fixture-resources.json` at the
 *      package root (not committed), else
 *   3. nothing → `harness.fixtures` is undefined → fixture suite skips.
 *
 * The pinned subscription must be in a clean starting state: status `active`
 * or `trialing`, `cancelAtPeriodEnd: false`, `pendingChange: null`, exactly
 * one item.
 */
export type PaddleHarness = ProviderTestHarness<PaddleCheckoutPresentation> & {
  provider: PaddleProvider;
};

export interface CreatePaddleHarnessOptions {
  /** Override the API key (defaults to `process.env.PADDLE_TEST_API_KEY`). */
  apiKey?: string;
  /**
   * Whether this harness backs the fixture conformance suite. When `true`,
   * the harness resolves an optional pinned `subscriptionId` (env → config
   * file). Defaults to `false`; the automated/self-setup/semi-manual specs
   * leave it unset so they do zero config IO and expose no `fixtures`.
   */
  fixtures?: boolean;
  /**
   * Override the path to the optional subscription-pin config file.
   * Defaults to `fixture-resources.json` at the provider-paddle package root.
   */
  fixtureConfigPath?: string;
}

/** The single pinnable fixture id — matches the SDK `ProviderTestFixtures`. */
type FixtureConfig = Required<NonNullable<PaddleHarness['fixtures']>>;

function defaultFixtureConfigPath(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', 'fixture-resources.json');
}

/**
 * Construct a fresh Paddle conformance harness. Async for symmetry with the
 * SDK runner's `Promise<ProviderTestHarness>` factory contract; resolving the
 * (optional) pinned fixture id is synchronous.
 */
export async function createPaddleHarness(
  options: CreatePaddleHarnessOptions = {},
): Promise<PaddleHarness> {
  const apiKey = options.apiKey ?? process.env.PADDLE_TEST_API_KEY;
  if (!apiKey) {
    throw new Error(
      'PADDLE_TEST_API_KEY env var is required to run the Paddle conformance suite. ' +
        'Set it to a Paddle sandbox API key (pdl_sdbx_...).',
    );
  }
  // Wrap once and share: the provider's calls and this harness's
  // consistency-check calls then pace against the same limiter instead of
  // racing each other into the rate limit.
  const paddle = wrapPaddleWithRateLimiting(
    new Paddle(apiKey, { environment: Environment.sandbox }),
  );
  // `PADDLE_HOSTED_CHECKOUT_URL` is the base hosted-checkout link the adapter
  // binds the transaction id to (`?_ptxn=…`) for the `paddle_hosted`
  // presentation, so the semi-manual suite's "press O to open" shortcut has a
  // real link. Set it to your sandbox hosted-checkout / default payment link
  // (e.g. `https://sandbox-pay.paddle.io/hsc_…`). Without it the presentation
  // falls back to the account default Paddle attaches, or an overlay with no
  // openable URL.
  const hostedCheckoutUrl = process.env.PADDLE_HOSTED_CHECKOUT_URL;
  const provider = createPaddleProvider({
    apiKey,
    client: paddle,
    ...(hostedCheckoutUrl ? { hostedCheckoutUrl } : {}),
  });

  // Paddle sandbox caps the number of notification settings per account, and
  // the webhooks conformance suite creates many. A run aborted before its
  // afterAll cleanup (or a prior interrupted run) leaves residue that fills
  // the cap and makes every subsequent `createEndpoint` fail with "Maximum
  // number of notification settings reached". Best-effort purge of stale
  // conformance-created endpoints (the suite always targets example.com) so
  // the cap can't be exhausted by leftovers across runs. Scoped to that host
  // so it can never delete a real endpoint; failures are ignored.
  try {
    const stale = await paddle.notificationSettings.list();
    await Promise.all(
      stale
        .filter((n) => n.destination.startsWith('https://example.com/'))
        .map((n) => paddle.notificationSettings.delete(n.id).catch(() => {})),
    );
  } catch {
    // Non-fatal: a list failure here must not block the suite.
  }

  const fixtures = options.fixtures
    ? resolveFixtures(options.fixtureConfigPath ?? defaultFixtureConfigPath())
    : undefined;

  return {
    label: 'paddle',
    provider,
    // Presence of `prompt` is the semi-manual opt-in signal; the interactive
    // "press O to open the checkout" UX is owned by the SDK's
    // `awaitManualStep`. `readlinePrompt` is just the non-TTY fallback.
    prompt: readlinePrompt,
    checkoutUrl: (presentation) =>
      presentation.kind === 'paddle_hosted' ? presentation.url : null,
    // No `setup`: Paddle can't create a subscription or complete a payment
    // via the API, so the self-setup subscription/payment tests skip and the
    // fixture + semi-manual suites cover those flows instead.
    ...(fixtures ? { fixtures } : {}),
    assertConsistency: {
      async customer(output) {
        const native = await paddle.customers.get(output.id);
        // Paddle "archive" flips status to 'archived' but the record is still
        // retrievable with its email/name — from the contract's view that IS
        // the archived state. Compare the identity fields regardless.
        //
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
        const native = await paddle.products.get(output.id);
        const nativeActive = native.status === 'active';
        if (nativeActive !== output.active) {
          throw new Error(
            `consistency: product ${output.id} active mismatch (native=${nativeActive}, normalized=${output.active})`,
          );
        }
        if (native.name !== output.name) {
          throw new Error(
            `consistency: product ${output.id} name mismatch (native=${native.name}, normalized=${output.name})`,
          );
        }
      },
      async price(output) {
        const native = await paddle.prices.get(output.id);
        const nativeActive = native.status === 'active';
        if (nativeActive !== output.active) {
          throw new Error(
            `consistency: price ${output.id} active mismatch (native=${nativeActive}, normalized=${output.active})`,
          );
        }
        const nativeAmount = Number.parseInt(native.unitPrice.amount, 10);
        if (nativeAmount !== output.unitAmount) {
          throw new Error(
            `consistency: price ${output.id} unit amount mismatch (native=${nativeAmount}, normalized=${output.unitAmount})`,
          );
        }
      },
      async subscription(output) {
        const native = await paddle.subscriptions.get(output.id);
        const nativeCancelAtPeriodEnd = native.scheduledChange?.action === 'cancel';
        if (nativeCancelAtPeriodEnd !== output.cancelAtPeriodEnd) {
          throw new Error(
            `consistency: subscription ${output.id} cancelAtPeriodEnd mismatch (native=${nativeCancelAtPeriodEnd}, normalized=${output.cancelAtPeriodEnd})`,
          );
        }
        if (native.items.length !== output.items.length) {
          throw new Error(
            `consistency: subscription ${output.id} item count mismatch (native=${native.items.length}, normalized=${output.items.length})`,
          );
        }
      },
      async discount(output) {
        const native = await paddle.discounts.get(output.id);
        const nativeActive = native.status === 'active';
        if (nativeActive !== output.active) {
          throw new Error(
            `consistency: discount ${output.id} active mismatch (native=${nativeActive}, normalized=${output.active})`,
          );
        }
        // `code` is adapter-managed in `customData` (Paddle's own `code` is
        // an unrelated auto-generated value), so it is not comparable against
        // the native field — the normalize round-trip already covers it.
      },
      async webhookEndpoint(output) {
        const native = await paddle.notificationSettings.get(output.id);
        if (native.active !== output.active) {
          throw new Error(
            `consistency: webhook endpoint ${output.id} active mismatch (native=${native.active}, normalized=${output.active})`,
          );
        }
        if (native.destination !== output.url) {
          throw new Error(
            `consistency: webhook endpoint ${output.id} url mismatch (native=${native.destination}, normalized=${output.url})`,
          );
        }
      },
    },
    async cleanupResource(kind, id) {
      // Best-effort hard-delete before the suites fall back to soft-delete.
      // Paddle only permits true deletion of notification settings; products,
      // prices, customers, discounts and subscriptions are archive-only, so
      // those fall through to the contract's soft-delete.
      switch (kind) {
        case 'webhookEndpoint':
          await paddle.notificationSettings.delete(id);
          return;
        case 'product':
        case 'price':
        case 'customer':
        case 'discount':
        case 'subscription':
        case 'checkoutSession':
          return;
      }
    },
    // No `teardown`: the fixture suite's only resource is an optional pinned
    // subscription that is never created or destroyed here.
  };
}

/**
 * Resolve an optional pinned subscription id for the fixture suite. Paddle
 * normally needs one (it can't bootstrap a subscription), so unlike Stripe
 * this is the primary path, not a debug override.
 */
function resolveFixtures(configPath: string): FixtureConfig | undefined {
  const fromEnv = process.env.PADDLE_FIXTURE_SUBSCRIPTION_ID;
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
  return undefined;
}
