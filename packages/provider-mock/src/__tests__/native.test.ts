import {
  ProviderConstraintError,
  ProviderNotFoundError,
  WebhookSignatureError,
} from '@its-just-billing/provider-sdk';
import { describe, expect, it } from 'vitest';
import { createMockProvider } from '../index.js';
import { signMockWebhook } from '../webhook-signing.js';

/**
 * Native tests for mock-specific behaviors not covered by the cross-provider
 * conformance suite. These are the validation paths added in response to PR
 * review (subscriptions.change price validation, webhook payload validation,
 * archived-customer checkout rejection).
 */

describe('subscriptions.change price validation', () => {
  it('throws ProviderNotFoundError when priceId does not exist', async () => {
    const provider = createMockProvider();
    const customer = await provider.customers.create({});
    const product = await provider.products.create({ name: 'p', taxCategory: 'saas' });
    const price = await provider.prices.create({
      productId: product.id,
      currency: 'usd',
      kind: 'recurring',
      unitAmount: 999,
      interval: 'month',
      intervalCount: 1,
    });
    const sub = provider.admin.createSubscription({
      customerId: customer.id,
      priceId: price.id,
    });
    await expect(
      provider.subscriptions.change({
        id: sub.id,
        items: [{ priceId: 'price_does_not_exist_xyz' }],
        when: 'immediately',
        prorationBehavior: 'create_prorations',
      }),
    ).rejects.toBeInstanceOf(ProviderNotFoundError);
  });

  it('throws ProviderConstraintError when priceId points to an inactive price', async () => {
    const provider = createMockProvider();
    const customer = await provider.customers.create({});
    const product = await provider.products.create({ name: 'p', taxCategory: 'saas' });
    const live = await provider.prices.create({
      productId: product.id,
      currency: 'usd',
      kind: 'recurring',
      unitAmount: 999,
      interval: 'month',
      intervalCount: 1,
    });
    const archived = await provider.prices.create({
      productId: product.id,
      currency: 'usd',
      kind: 'recurring',
      unitAmount: 1999,
      interval: 'month',
      intervalCount: 1,
    });
    await provider.prices.deactivate({ id: archived.id });
    const sub = provider.admin.createSubscription({
      customerId: customer.id,
      priceId: live.id,
    });
    await expect(
      provider.subscriptions.change({
        id: sub.id,
        items: [{ priceId: archived.id }],
        when: 'immediately',
        prorationBehavior: 'create_prorations',
      }),
    ).rejects.toBeInstanceOf(ProviderConstraintError);
  });

  it('throws ProviderConstraintError when priceId points to a one_time price', async () => {
    const provider = createMockProvider();
    const customer = await provider.customers.create({});
    const product = await provider.products.create({ name: 'p', taxCategory: 'saas' });
    const recurring = await provider.prices.create({
      productId: product.id,
      currency: 'usd',
      kind: 'recurring',
      unitAmount: 999,
      interval: 'month',
      intervalCount: 1,
    });
    const oneTime = await provider.prices.create({
      productId: product.id,
      currency: 'usd',
      kind: 'one_time',
      unitAmount: 500,
    });
    const sub = provider.admin.createSubscription({
      customerId: customer.id,
      priceId: recurring.id,
    });
    await expect(
      provider.subscriptions.change({
        id: sub.id,
        items: [{ priceId: oneTime.id }],
        when: 'immediately',
        prorationBehavior: 'create_prorations',
      }),
    ).rejects.toBeInstanceOf(ProviderConstraintError);
  });

  it('throws ProviderConstraintError when quantity violates price constraint', async () => {
    const provider = createMockProvider();
    const customer = await provider.customers.create({});
    const product = await provider.products.create({ name: 'p', taxCategory: 'saas' });
    const seat = await provider.prices.create({
      productId: product.id,
      currency: 'usd',
      kind: 'recurring',
      unitAmount: 999,
      interval: 'month',
      intervalCount: 1,
      quantity: { min: 1, max: 5 },
    });
    const sub = provider.admin.createSubscription({
      customerId: customer.id,
      priceId: seat.id,
    });
    await expect(
      provider.subscriptions.change({
        id: sub.id,
        items: [{ priceId: seat.id, quantity: 10 }],
        when: 'immediately',
        prorationBehavior: 'create_prorations',
      }),
    ).rejects.toBeInstanceOf(ProviderConstraintError);
  });

  it('accepts a valid change and keeps the subscription consistent', async () => {
    const provider = createMockProvider();
    const customer = await provider.customers.create({});
    const product = await provider.products.create({ name: 'p', taxCategory: 'saas' });
    const a = await provider.prices.create({
      productId: product.id,
      currency: 'usd',
      kind: 'recurring',
      unitAmount: 999,
      interval: 'month',
      intervalCount: 1,
    });
    const b = await provider.prices.create({
      productId: product.id,
      currency: 'usd',
      kind: 'recurring',
      unitAmount: 1999,
      interval: 'month',
      intervalCount: 1,
    });
    const sub = provider.admin.createSubscription({
      customerId: customer.id,
      priceId: a.id,
    });
    const out = await provider.subscriptions.change({
      id: sub.id,
      items: [{ priceId: b.id, quantity: 1 }],
      when: 'immediately',
      prorationBehavior: 'create_prorations',
    });
    expect(out.items.length).toBe(1);
    expect(out.items[0]?.priceId).toBe(b.id);
  });
});

describe('webhooks.verify payload validation', () => {
  const secret = 'whsec_native_test';

  function signed(payload: unknown): { payload: string; signature: string } {
    const body = JSON.stringify(payload);
    return { payload: body, signature: signMockWebhook(body, secret) };
  }

  it('accepts a well-formed payload', async () => {
    const provider = createMockProvider();
    const wire = signed({
      id: 'evt_1',
      type: 'customer.created',
      resource: { kind: 'customer', id: 'cus_1' },
      occurredAt: new Date().toISOString(),
    });
    const event = await provider.webhooks.verify({ ...wire, secret });
    expect(event.type).toBe('customer.created');
    expect(event.resource.id).toBe('cus_1');
    expect(event.occurredAt).toBeInstanceOf(Date);
  });

  it('rejects a payload with an unknown event type', async () => {
    const provider = createMockProvider();
    const wire = signed({
      id: 'evt_1',
      type: 'customer.exploded',
      resource: { kind: 'customer', id: 'cus_1' },
      occurredAt: new Date().toISOString(),
    });
    await expect(provider.webhooks.verify({ ...wire, secret })).rejects.toBeInstanceOf(
      WebhookSignatureError,
    );
  });

  it('rejects a payload with an unknown resource kind', async () => {
    const provider = createMockProvider();
    const wire = signed({
      id: 'evt_1',
      type: 'customer.created',
      resource: { kind: 'unicorn', id: 'cus_1' },
      occurredAt: new Date().toISOString(),
    });
    await expect(provider.webhooks.verify({ ...wire, secret })).rejects.toBeInstanceOf(
      WebhookSignatureError,
    );
  });

  it('rejects a payload with an unparseable occurredAt', async () => {
    const provider = createMockProvider();
    const wire = signed({
      id: 'evt_1',
      type: 'customer.created',
      resource: { kind: 'customer', id: 'cus_1' },
      occurredAt: 'not-a-date',
    });
    await expect(provider.webhooks.verify({ ...wire, secret })).rejects.toBeInstanceOf(
      WebhookSignatureError,
    );
  });

  it('rejects a payload with an empty id', async () => {
    const provider = createMockProvider();
    const wire = signed({
      id: '',
      type: 'customer.created',
      resource: { kind: 'customer', id: 'cus_1' },
      occurredAt: new Date().toISOString(),
    });
    await expect(provider.webhooks.verify({ ...wire, secret })).rejects.toBeInstanceOf(
      WebhookSignatureError,
    );
  });
});

describe('checkout.createSession archived-customer rejection', () => {
  it('throws ProviderNotFoundError when customerId belongs to an archived customer', async () => {
    const provider = createMockProvider();
    const customer = await provider.customers.create({});
    const product = await provider.products.create({ name: 'p', taxCategory: 'saas' });
    const price = await provider.prices.create({
      productId: product.id,
      currency: 'usd',
      kind: 'one_time',
      unitAmount: 1000,
    });
    await provider.customers.archive({ id: customer.id });
    await expect(
      provider.checkout.createSession({
        lineItems: [{ priceId: price.id, quantity: 1 }],
        successUrl: 'https://example.com/s',
        customerId: customer.id,
      }),
    ).rejects.toBeInstanceOf(ProviderNotFoundError);
  });

  it('still accepts a live customer', async () => {
    const provider = createMockProvider();
    const customer = await provider.customers.create({});
    const product = await provider.products.create({ name: 'p', taxCategory: 'saas' });
    const price = await provider.prices.create({
      productId: product.id,
      currency: 'usd',
      kind: 'one_time',
      unitAmount: 1000,
    });
    const session = await provider.checkout.createSession({
      lineItems: [{ priceId: price.id, quantity: 1 }],
      successUrl: 'https://example.com/s',
      customerId: customer.id,
    });
    expect(session.customerId).toBe(customer.id);
  });
});

describe('checkout.createSession price activity validation', () => {
  it('throws ProviderConstraintError when a lineItem price has been deactivated', async () => {
    const provider = createMockProvider();
    const product = await provider.products.create({ name: 'p', taxCategory: 'saas' });
    const price = await provider.prices.create({
      productId: product.id,
      currency: 'usd',
      kind: 'one_time',
      unitAmount: 1000,
    });
    await provider.prices.deactivate({ id: price.id });
    await expect(
      provider.checkout.createSession({
        lineItems: [{ priceId: price.id, quantity: 1 }],
        successUrl: 'https://example.com/s',
      }),
    ).rejects.toBeInstanceOf(ProviderConstraintError);
  });
});

describe('checkout.createSession discount activity validation', () => {
  it('throws ProviderConstraintError when discount lookup by id resolves to an inactive discount', async () => {
    const provider = createMockProvider();
    const product = await provider.products.create({ name: 'p', taxCategory: 'saas' });
    const price = await provider.prices.create({
      productId: product.id,
      currency: 'usd',
      kind: 'one_time',
      unitAmount: 1000,
    });
    const discount = await provider.discounts.create({
      benefit: { kind: 'percent', percentOff: 10 },
      duration: { kind: 'once' },
    });
    await provider.discounts.deactivate({ id: discount.id });
    await expect(
      provider.checkout.createSession({
        lineItems: [{ priceId: price.id, quantity: 1 }],
        successUrl: 'https://example.com/s',
        discount: { kind: 'discountId', discountId: discount.id },
      }),
    ).rejects.toBeInstanceOf(ProviderConstraintError);
  });

  it('throws ProviderConstraintError when discount lookup by code resolves to an inactive discount', async () => {
    const provider = createMockProvider();
    const product = await provider.products.create({ name: 'p', taxCategory: 'saas' });
    const price = await provider.prices.create({
      productId: product.id,
      currency: 'usd',
      kind: 'one_time',
      unitAmount: 1000,
    });
    const discount = await provider.discounts.create({
      code: 'SUMMER10',
      benefit: { kind: 'percent', percentOff: 10 },
      duration: { kind: 'once' },
    });
    await provider.discounts.deactivate({ id: discount.id });
    await expect(
      provider.checkout.createSession({
        lineItems: [{ priceId: price.id, quantity: 1 }],
        successUrl: 'https://example.com/s',
        discount: { kind: 'code', code: 'SUMMER10' },
      }),
    ).rejects.toBeInstanceOf(ProviderConstraintError);
  });
});

describe('checkout.createSession mixed-currency rejection', () => {
  it('throws ProviderConstraintError when lineItems reference prices with different currencies', async () => {
    const provider = createMockProvider();
    const product = await provider.products.create({ name: 'p', taxCategory: 'saas' });
    const usd = await provider.prices.create({
      productId: product.id,
      currency: 'usd',
      kind: 'one_time',
      unitAmount: 1000,
    });
    const eur = await provider.prices.create({
      productId: product.id,
      currency: 'eur',
      kind: 'one_time',
      unitAmount: 900,
    });
    await expect(
      provider.checkout.createSession({
        lineItems: [
          { priceId: usd.id, quantity: 1 },
          { priceId: eur.id, quantity: 1 },
        ],
        successUrl: 'https://example.com/s',
      }),
    ).rejects.toBeInstanceOf(ProviderConstraintError);
  });

  it('accepts multiple line items that share the same currency', async () => {
    const provider = createMockProvider();
    const product = await provider.products.create({ name: 'p', taxCategory: 'saas' });
    const a = await provider.prices.create({
      productId: product.id,
      currency: 'usd',
      kind: 'one_time',
      unitAmount: 1000,
    });
    const b = await provider.prices.create({
      productId: product.id,
      currency: 'usd',
      kind: 'one_time',
      unitAmount: 500,
    });
    const session = await provider.checkout.createSession({
      lineItems: [
        { priceId: a.id, quantity: 1 },
        { priceId: b.id, quantity: 2 },
      ],
      successUrl: 'https://example.com/s',
    });
    expect(session.lineItems.length).toBe(2);
  });
});

describe('mock normalizers clone Date fields', () => {
  it('customer.createdAt returned from create is not the stored Date', async () => {
    const provider = createMockProvider();
    const created = await provider.customers.create({});
    const before = created.createdAt.getTime();
    created.createdAt.setTime(0);
    const fetched = await provider.customers.get({ id: created.id });
    expect(fetched).not.toBeNull();
    expect(fetched?.createdAt.getTime()).toBe(before);
  });

  it('price.createdAt returned from create is not the stored Date', async () => {
    const provider = createMockProvider();
    const product = await provider.products.create({ name: 'p', taxCategory: 'saas' });
    const created = await provider.prices.create({
      productId: product.id,
      currency: 'usd',
      kind: 'one_time',
      unitAmount: 100,
    });
    const before = created.createdAt.getTime();
    created.createdAt.setTime(0);
    const fetched = await provider.prices.get({ id: created.id });
    expect(fetched).not.toBeNull();
    expect(fetched?.createdAt.getTime()).toBe(before);
  });

  it('subscription dates returned from admin.createSubscription are not the stored Dates', async () => {
    const provider = createMockProvider();
    const customer = await provider.customers.create({});
    const product = await provider.products.create({ name: 'p', taxCategory: 'saas' });
    const price = await provider.prices.create({
      productId: product.id,
      currency: 'usd',
      kind: 'recurring',
      unitAmount: 999,
      interval: 'month',
      intervalCount: 1,
    });
    const sub = provider.admin.createSubscription({
      customerId: customer.id,
      priceId: price.id,
    });
    const periodEndBefore = sub.currentPeriodEnd.getTime();
    sub.currentPeriodEnd.setTime(0);
    sub.createdAt.setTime(0);
    const fetched = await provider.subscriptions.get({ id: sub.id });
    expect(fetched).not.toBeNull();
    expect(fetched?.currentPeriodEnd.getTime()).toBe(periodEndBefore);
  });
});

describe('admin.createSubscription quantity validation', () => {
  async function setup() {
    const provider = createMockProvider();
    const customer = await provider.customers.create({});
    const product = await provider.products.create({ name: 'p', taxCategory: 'saas' });
    const price = await provider.prices.create({
      productId: product.id,
      currency: 'usd',
      kind: 'recurring',
      unitAmount: 999,
      interval: 'month',
      intervalCount: 1,
      quantity: { min: 2, max: 5 },
    });
    return { provider, customer, price };
  }

  it('throws ProviderConstraintError when quantity is 0', async () => {
    const { provider, customer, price } = await setup();
    expect(() =>
      provider.admin.createSubscription({
        customerId: customer.id,
        priceId: price.id,
        quantity: 0,
      }),
    ).toThrow(ProviderConstraintError);
  });

  it('throws ProviderConstraintError when quantity is below min', async () => {
    const { provider, customer, price } = await setup();
    expect(() =>
      provider.admin.createSubscription({
        customerId: customer.id,
        priceId: price.id,
        quantity: 1,
      }),
    ).toThrow(ProviderConstraintError);
  });

  it('throws ProviderConstraintError when quantity exceeds max', async () => {
    const { provider, customer, price } = await setup();
    expect(() =>
      provider.admin.createSubscription({
        customerId: customer.id,
        priceId: price.id,
        quantity: 10,
      }),
    ).toThrow(ProviderConstraintError);
  });

  it('throws ProviderConstraintError when default quantity 1 is below the price minimum', async () => {
    // No explicit quantity → defaults to 1, which is below {min:2, max:5}.
    const { provider, customer, price } = await setup();
    expect(() =>
      provider.admin.createSubscription({
        customerId: customer.id,
        priceId: price.id,
      }),
    ).toThrow(ProviderConstraintError);
  });

  it('accepts a quantity inside the price constraint', async () => {
    const { provider, customer, price } = await setup();
    const sub = provider.admin.createSubscription({
      customerId: customer.id,
      priceId: price.id,
      quantity: 3,
    });
    expect(sub.items[0]?.quantity).toBe(3);
  });
});

describe('subscriptions.change clears pending cancellation', () => {
  async function setupActive() {
    const provider = createMockProvider();
    const customer = await provider.customers.create({});
    const product = await provider.products.create({ name: 'p', taxCategory: 'saas' });
    const a = await provider.prices.create({
      productId: product.id,
      currency: 'usd',
      kind: 'recurring',
      unitAmount: 999,
      interval: 'month',
      intervalCount: 1,
    });
    const b = await provider.prices.create({
      productId: product.id,
      currency: 'usd',
      kind: 'recurring',
      unitAmount: 1999,
      interval: 'month',
      intervalCount: 1,
    });
    const sub = provider.admin.createSubscription({ customerId: customer.id, priceId: a.id });
    return { provider, sub, priceA: a, priceB: b };
  }

  it("change({when:'immediately'}) clears cancelAtPeriodEnd from a previous cancel", async () => {
    const { provider, sub, priceB } = await setupActive();
    const cancelled = await provider.subscriptions.cancel({ id: sub.id, when: 'at_period_end' });
    expect(cancelled.cancelAtPeriodEnd).toBe(true);
    expect(cancelled.pendingChange?.kind).toBe('cancel');

    const changed = await provider.subscriptions.change({
      id: sub.id,
      items: [{ priceId: priceB.id, quantity: 1 }],
      when: 'immediately',
      prorationBehavior: 'create_prorations',
    });
    expect(changed.cancelAtPeriodEnd).toBe(false);
    expect(changed.pendingChange).toBeNull();
    expect(changed.items[0]?.priceId).toBe(priceB.id);
  });

  it("change({when:'at_period_end'}) clears cancelAtPeriodEnd and replaces pendingChange with price_change", async () => {
    const { provider, sub, priceB } = await setupActive();
    await provider.subscriptions.cancel({ id: sub.id, when: 'at_period_end' });

    const changed = await provider.subscriptions.change({
      id: sub.id,
      items: [{ priceId: priceB.id, quantity: 1 }],
      when: 'at_period_end',
      prorationBehavior: 'create_prorations',
    });
    expect(changed.cancelAtPeriodEnd).toBe(false);
    expect(changed.pendingChange?.kind).toBe('price_change');
  });
});

describe('webhooks.listEndpoints returns every endpoint', () => {
  it('returns more than the paginate() default cap of 100 in a single page', async () => {
    const provider = createMockProvider();
    const target = 105;
    for (let i = 0; i < target; i++) {
      await provider.webhooks.createEndpoint({
        url: `https://example.com/hook-${i}`,
        eventTypes: ['customer.created'],
      });
    }
    const page = await provider.webhooks.listEndpoints();
    expect(page.data.length).toBe(target);
    expect(page.nextCursor).toBeNull();
  });
});
