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

export interface Subscriptions {
  list(input: SubscriptionsListInput): Promise<SubscriptionsListOutput>;
  get(input: SubscriptionsGetInput): Promise<SubscriptionsGetOutput>;
  cancel(input: SubscriptionsCancelInput): Promise<SubscriptionsCancelOutput>;
  change(input: SubscriptionsChangeInput): Promise<SubscriptionsChangeOutput>;
  cancelScheduledChange(
    input: SubscriptionsCancelScheduledChangeInput,
  ): Promise<SubscriptionsCancelScheduledChangeOutput>;
}
