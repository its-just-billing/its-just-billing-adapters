import type {
  CheckoutSessionStatus,
  DiscountBenefit,
  DiscountDuration,
  EventResourceKind,
  Metadata,
  PendingSubscriptionChange,
  PriceKind,
  ProviderEvent,
  ProviderEventType,
  Quantity,
  RecurringInterval,
  SubscriptionItem,
  SubscriptionStatus,
  TrialSpec,
} from '@its-just-billing/provider-sdk';

/**
 * Internal record shapes. Caller-visible metadata is stripped of `__provider_*`
 * keys at normalize-time; the internal record stores the merged form so
 * adapter-managed state (quantity bounds, etc.) survives round-trips.
 */

export interface InternalCustomer {
  id: string;
  email: string | null;
  name: string | null;
  metadata: Metadata;
  createdAt: Date;
  archived: boolean;
}

export interface InternalProduct {
  id: string;
  name: string;
  description: string | null;
  active: boolean;
  taxCategory: string | null;
  metadata: Metadata;
  createdAt: Date;
  updatedAt: Date;
}

export interface InternalPriceOneTime {
  kind: 'one_time';
  unitAmount: number;
}

export interface InternalPriceRecurring {
  kind: 'recurring';
  unitAmount: number;
  interval: RecurringInterval;
  intervalCount: number;
}

export interface InternalPrice {
  id: string;
  productId: string;
  active: boolean;
  currency: string;
  quantity: Quantity;
  metadata: Metadata;
  createdAt: Date;
  updatedAt: Date;
  spec: InternalPriceOneTime | InternalPriceRecurring;
}

export interface InternalDiscount {
  id: string;
  code: string | null;
  benefit: DiscountBenefit;
  duration: DiscountDuration;
  active: boolean;
  expiresAt: Date | null;
  redemptionLimit: number | null;
  redemptionCount: number;
  restrictedTo: { productIds?: string[] | undefined; priceIds?: string[] | undefined } | null;
  metadata: Metadata;
  createdAt: Date;
}

export interface InternalAppliedDiscount {
  discountId: string;
  code: string | null;
  amountDiscounted: { amount: number; currency: string };
}

export interface InternalCheckoutSession {
  id: string;
  status: CheckoutSessionStatus;
  customerId: string | null;
  lineItems: { priceId: string; quantity: number }[];
  successUrl: string;
  cancelUrl: string | null;
  appliedDiscounts: InternalAppliedDiscount[];
  trial: TrialSpec | null;
  metadata: Metadata;
  expiresAt: Date | null;
  createdAt: Date;
}

export interface InternalSubscription {
  id: string;
  customerId: string;
  status: SubscriptionStatus;
  items: SubscriptionItem[];
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  trialEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  canceledAt: Date | null;
  pendingChange: PendingSubscriptionChange | null;
  metadata: Metadata;
  createdAt: Date;
}

export interface InternalPayment {
  id: string;
  customerId: string | null;
  status: 'pending' | 'succeeded' | 'failed' | 'refunded' | 'partially_refunded';
  amount: { amount: number; currency: string };
  subtotal: { amount: number; currency: string } | null;
  amountRefunded: { amount: number; currency: string } | null;
  appliedDiscounts: InternalAppliedDiscount[];
  priceId: string | null;
  productId: string | null;
  checkoutSessionId: string | null;
  metadata: Metadata;
  createdAt: Date;
}

export interface InternalWebhookEndpoint {
  id: string;
  url: string;
  eventTypes: ProviderEventType[];
  active: boolean;
  createdAt: Date;
  secret: string;
}

export interface StoredEvent {
  id: string;
  type: ProviderEventType;
  resource: { kind: EventResourceKind; id: string };
  occurredAt: Date;
  payload: unknown;
}

const EVENT_BUFFER_LIMIT = 1000;

/**
 * In-memory backing store for the mock provider. Exposed via `provider.raw`
 * so tests and the harness can introspect or seed data without going through
 * the public SDK surface.
 */
export class MockState {
  readonly customers = new Map<string, InternalCustomer>();
  readonly products = new Map<string, InternalProduct>();
  readonly prices = new Map<string, InternalPrice>();
  readonly subscriptions = new Map<string, InternalSubscription>();
  readonly checkoutSessions = new Map<string, InternalCheckoutSession>();
  readonly payments = new Map<string, InternalPayment>();
  readonly discounts = new Map<string, InternalDiscount>();
  readonly webhookEndpoints = new Map<string, InternalWebhookEndpoint>();
  /** Newest events at the tail. */
  readonly events: StoredEvent[] = [];

  emit(
    type: ProviderEventType,
    resource: { kind: EventResourceKind; id: string },
    payload?: unknown,
  ): StoredEvent {
    const ev: StoredEvent = {
      id: `evt_mock_${this.events.length + 1}_${Math.random().toString(36).slice(2, 8)}`,
      type,
      resource,
      occurredAt: new Date(),
      payload,
    };
    this.events.push(ev);
    if (this.events.length > EVENT_BUFFER_LIMIT) {
      this.events.splice(0, this.events.length - EVENT_BUFFER_LIMIT);
    }
    return ev;
  }
}

export function listProviderEvents(state: MockState): ProviderEvent[] {
  return state.events.map((e) => ({
    id: e.id,
    type: e.type,
    resource: e.resource,
    occurredAt: e.occurredAt,
    payload: e.payload,
  }));
}
