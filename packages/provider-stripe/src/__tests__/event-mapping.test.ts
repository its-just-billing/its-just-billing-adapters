import type Stripe from 'stripe';
import { describe, expect, it } from 'vitest';
import { STRIPE_TO_NORMALIZED_EVENT, maybeNormalizeStripeEvent } from '../normalize/event.js';

describe('Stripe event normalization', () => {
  it('does not map coupon.* events to discount.* events', () => {
    // Coupon events carry a `coupon_...` id; the adapter's discounts domain
    // identifies discounts by their PromotionCode id (`promo_...`). Emitting
    // a discount.* event with a coupon id breaks the "use resource.id to
    // refetch" contract: `provider.discounts.get({ id: 'coupon_...' })`
    // returns null because the id isn't a promotion code. The map must omit
    // these source types so the bad-id event never reaches consumers.
    expect(STRIPE_TO_NORMALIZED_EVENT['coupon.created']).toBeUndefined();
    expect(STRIPE_TO_NORMALIZED_EVENT['coupon.updated']).toBeUndefined();
    expect(STRIPE_TO_NORMALIZED_EVENT['coupon.deleted']).toBeUndefined();
  });

  it('drops a synthetic coupon.created event when normalizing', () => {
    // Construct a coupon event shaped like Stripe's webhook payload and
    // confirm the normalizer returns null (i.e. the event is filtered out).
    const couponEvent = {
      id: 'evt_test_coupon',
      object: 'event',
      type: 'coupon.created',
      api_version: '2025-08-27.basil',
      created: 1_700_000_000,
      livemode: false,
      pending_webhooks: 0,
      request: null,
      data: {
        object: {
          id: 'coupon_TEST123',
          object: 'coupon',
          percent_off: 10,
          duration: 'once',
        },
      },
    } as unknown as Stripe.Event;
    expect(maybeNormalizeStripeEvent(couponEvent)).toBeNull();
  });

  it('maps promotion_code.* events to discount.* events with the promo id', () => {
    // Sibling check: the promotion-code path remains active and carries the
    // id consumers can use to refetch via `discounts.get`.
    expect(STRIPE_TO_NORMALIZED_EVENT['promotion_code.created']).toBe('discount.created');
    expect(STRIPE_TO_NORMALIZED_EVENT['promotion_code.updated']).toBe('discount.updated');

    const promoEvent = {
      id: 'evt_test_promo',
      object: 'event',
      type: 'promotion_code.created',
      api_version: '2025-08-27.basil',
      created: 1_700_000_000,
      livemode: false,
      pending_webhooks: 0,
      request: null,
      data: {
        object: {
          id: 'promo_TEST123',
          object: 'promotion_code',
          active: true,
          code: 'SAVE10',
          coupon: { id: 'coupon_TEST123', object: 'coupon' },
        },
      },
    } as unknown as Stripe.Event;
    const normalized = maybeNormalizeStripeEvent(promoEvent);
    expect(normalized).not.toBeNull();
    expect(normalized?.type).toBe('discount.created');
    // Resource id is the promo id, NOT the underlying coupon id. This is
    // the id that `provider.discounts.get({ id })` can resolve.
    expect(normalized?.resource.id).toBe('promo_TEST123');
    expect(normalized?.resource.kind).toBe('discount');
  });

  it('maps customer.subscription.trial_will_end → subscription.trial_will_end', () => {
    // Stripe does fire this event natively. Sibling event
    // `subscription.trial_ended` has no Stripe analog and is intentionally
    // absent from STRIPE_TO_NORMALIZED_EVENT.
    expect(STRIPE_TO_NORMALIZED_EVENT['customer.subscription.trial_will_end']).toBe(
      'subscription.trial_will_end',
    );
    const trialEvent = {
      id: 'evt_test_trial_will_end',
      object: 'event',
      type: 'customer.subscription.trial_will_end',
      api_version: '2025-08-27.basil',
      created: 1_700_000_000,
      livemode: false,
      pending_webhooks: 0,
      request: null,
      data: {
        object: {
          id: 'sub_TEST',
          object: 'subscription',
          status: 'trialing',
        },
      },
    } as unknown as Stripe.Event;
    const normalized = maybeNormalizeStripeEvent(trialEvent);
    expect(normalized).not.toBeNull();
    expect(normalized?.type).toBe('subscription.trial_will_end');
    expect(normalized?.resource.kind).toBe('subscription');
    expect(normalized?.resource.id).toBe('sub_TEST');
  });

  it('does NOT synthesize subscription.trial_ended from customer.subscription.updated', () => {
    // Stripe never emits a dedicated trial_ended event. The SDK does not
    // manufacture one either — consumers diff `status` across updates
    // themselves. A customer.subscription.updated whose previous status was
    // 'trialing' resolves to a plain subscription.updated, nothing more.
    const subUpdate = {
      id: 'evt_test_sub_updated',
      object: 'event',
      type: 'customer.subscription.updated',
      api_version: '2025-08-27.basil',
      created: 1_700_000_000,
      livemode: false,
      pending_webhooks: 0,
      request: null,
      data: {
        object: {
          id: 'sub_TEST',
          object: 'subscription',
          status: 'active',
        },
        previous_attributes: { status: 'trialing' },
      },
    } as unknown as Stripe.Event;
    const normalized = maybeNormalizeStripeEvent(subUpdate);
    expect(normalized).not.toBeNull();
    expect(normalized?.type).toBe('subscription.updated');
  });
});
