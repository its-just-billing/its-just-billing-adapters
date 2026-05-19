import type { EventEntity } from '@paddle/paddle-node-sdk';
import { describe, expect, it } from 'vitest';
import { maybeNormalizePaddleEvent } from '../normalize/event.js';

describe('Paddle event normalization', () => {
  it('uses the adjustment transactionId (not the adjustment id) for payment.refunded', () => {
    // A Paddle `adjustment.created` event's `data.id` is the adjustment id
    // (`adj_...`), but it normalizes to `payment.refunded` with
    // `resource.kind: 'payment'`. The SDK contract is "refetch via
    // `payments.get({ id: resource.id })`" — so `resource.id` must be the
    // adjustment's `transactionId` (`txn_...`), or consumers refetch a
    // non-existent payment.
    const event = {
      eventId: 'evt_adj_1',
      eventType: 'adjustment.created',
      occurredAt: '2024-01-01T00:00:00.000Z',
      data: { id: 'adj_123', transactionId: 'txn_456' },
    } as unknown as EventEntity;

    const normalized = maybeNormalizePaddleEvent(event);
    expect(normalized).not.toBeNull();
    expect(normalized?.type).toBe('payment.refunded');
    expect(normalized?.resource.kind).toBe('payment');
    expect(normalized?.resource.id).toBe('txn_456');
    // The full adjustment is still available on the payload.
    expect((normalized?.payload as { id?: string }).id).toBe('adj_123');
  });

  it('drops an adjustment event with no transactionId rather than emitting an unresolvable payment id', () => {
    const event = {
      eventId: 'evt_adj_2',
      eventType: 'adjustment.created',
      occurredAt: '2024-01-01T00:00:00.000Z',
      data: { id: 'adj_789' },
    } as unknown as EventEntity;

    expect(maybeNormalizePaddleEvent(event)).toBeNull();
  });

  it('uses data.id for non-refund events (e.g. transaction.completed → payment.succeeded)', () => {
    const event = {
      eventId: 'evt_txn_1',
      eventType: 'transaction.completed',
      occurredAt: '2024-01-01T00:00:00.000Z',
      data: { id: 'txn_999' },
    } as unknown as EventEntity;

    const normalized = maybeNormalizePaddleEvent(event);
    expect(normalized?.type).toBe('payment.succeeded');
    expect(normalized?.resource.id).toBe('txn_999');
  });

  it('drops Paddle types with no normalized mapping', () => {
    const event = {
      eventId: 'evt_x',
      eventType: 'payout.created',
      occurredAt: '2024-01-01T00:00:00.000Z',
      data: { id: 'pay_1' },
    } as unknown as EventEntity;

    expect(maybeNormalizePaddleEvent(event)).toBeNull();
  });
});
