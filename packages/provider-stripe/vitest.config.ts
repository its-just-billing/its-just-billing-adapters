import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Live Stripe conformance tests make several sequential API calls per
    // scenario (especially `subscriptions.change(at_period_end)`, which
    // creates and updates a SubscriptionSchedule). At ~500-1000ms per round
    // trip, 5s isn't enough headroom. Bump globally; vitest's per-suite
    // overrides remain available if any test needs less.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
