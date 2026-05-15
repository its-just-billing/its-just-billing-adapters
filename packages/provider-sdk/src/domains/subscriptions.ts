import type {
  SubscriptionsCancelInput,
  SubscriptionsCancelOutput,
  SubscriptionsCancelScheduledChangeInput,
  SubscriptionsCancelScheduledChangeOutput,
  SubscriptionsChangeInput,
  SubscriptionsChangeOutput,
  SubscriptionsGetInput,
  SubscriptionsGetOutput,
  SubscriptionsListInput,
  SubscriptionsListOutput,
} from '../schemas/subscriptions/index.js';

export interface Subscriptions<TRaw = unknown> {
  list(input: SubscriptionsListInput): Promise<SubscriptionsListOutput<TRaw>>;
  get(input: SubscriptionsGetInput): Promise<SubscriptionsGetOutput<TRaw>>;
  cancel(input: SubscriptionsCancelInput): Promise<SubscriptionsCancelOutput<TRaw>>;
  change(input: SubscriptionsChangeInput): Promise<SubscriptionsChangeOutput<TRaw>>;
  cancelScheduledChange(
    input: SubscriptionsCancelScheduledChangeInput,
  ): Promise<SubscriptionsCancelScheduledChangeOutput<TRaw>>;
}
