/**
 * Metadata key that marks a Stripe `SubscriptionSchedule` as authored by the
 * SDK. The normalizer uses this to distinguish SDK-managed schedules (which
 * it knows how to parse into `pendingChange`) from any other schedule that
 * may have been created out-of-band (dashboard, direct API call, etc).
 *
 * Set on the schedule object's metadata — not on the subscription, since the
 * subscription's metadata is part of the public surface.
 */
export const SDK_SCHEDULE_MARKER_KEY = '__provider_sdk_schedule';
export const SDK_SCHEDULE_MARKER_VALUE = '1';

export function isSdkAuthoredSchedule(
  metadata: Record<string, string> | null | undefined,
): boolean {
  return metadata?.[SDK_SCHEDULE_MARKER_KEY] === SDK_SCHEDULE_MARKER_VALUE;
}
