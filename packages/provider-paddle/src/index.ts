// Paddle provider — populated in phase 8.
//
// When implemented, declare `PADDLE_CAPABILITIES: ProviderCapabilities` (see
// `provider-stripe/src/capabilities.ts` for the shape). Known Paddle flags:
//
//   features.priceQuantityConstraints: true
//     Paddle has native price-level quantity constraints — enforce them
//     (no extra round-trip), unlike Stripe.
//   features.priceLevelRecurrence: true
//   features.productLevelRecurrence: false
//     Paddle models recurrence on the price, like Stripe.
//   features.discountProductRestrictions / discountPriceRestrictions:
//     determine from Paddle's native discount-restriction surface; round-trip
//     (don't fake) anything it can't enforce natively.
//   trialUnits: the units Paddle's trial API accepts.
//
// The `features` object is exhaustive in the type, so TypeScript forces every
// flag to be declared explicitly when this is filled in.
export {};
