import type {
  ProviderCapabilities,
  ProviderFeatureFlags,
  RecurrenceModel,
} from './models/capabilities.js';
import { type RecurringInterval, RecurringIntervalSchema } from './models/price.js';

/**
 * The per-provider capability profile fragment.
 *
 * Single source of truth for the fragment SHAPE lives here so the three
 * consumers agree: each provider's `profile:emit` script (derives it from its
 * real `*_CAPABILITIES`), the provider snapshot test (re-derives and asserts
 * the committed file matches), and `provider-sdk`'s `build-docs` (reads,
 * validates with {@link parseProfileFragment}, and merges into
 * `docs/openapi/capability-profiles.json`).
 *
 * Only the *shape-conditioning* capabilities are included: `features` (the
 * structural flags), `recurrenceModel` (where recurrence lives), and the
 * `trialUnits` / `recurringIntervals` value-set narrowings. currencies /
 * taxCategories / webhookEventTypes are large enums that gate values without
 * changing request/response *shape*, so they are intentionally out of scope.
 */
export interface ProviderProfileFragment {
  readonly providerId: string;
  readonly features: ProviderFeatureFlags;
  readonly recurrenceModel: RecurrenceModel;
  /** Sorted subset of `RecurringInterval`. */
  readonly trialUnits: RecurringInterval[];
  /** Sorted subset of `RecurringInterval`. */
  readonly recurringIntervals: RecurringInterval[];
}

/**
 * Exhaustive `ProviderFeatureFlags` key list. `Record<keyof …, true>` makes
 * TypeScript fail the build if a flag is added/removed without updating this
 * — so fragment validation can never silently drift from the contract.
 */
const FEATURE_FLAG_KEY_MAP: Record<keyof ProviderFeatureFlags, true> = {
  priceQuantityConstraints: true,
  discountProductRestrictions: true,
  discountPriceRestrictions: true,
};

export const FEATURE_FLAG_KEYS = Object.keys(
  FEATURE_FLAG_KEY_MAP,
) as (keyof ProviderFeatureFlags)[];

export const TRIAL_UNIT_FULL_ENUM = RecurringIntervalSchema.options as readonly RecurringInterval[];

const RECURRENCE_MODELS: readonly RecurrenceModel[] = ['price', 'product'];

function assertIntervalSubset(
  expectedProviderId: string,
  field: string,
  value: unknown,
): RecurringInterval[] {
  if (
    !Array.isArray(value) ||
    value.some((u) => !(TRIAL_UNIT_FULL_ENUM as string[]).includes(u as string))
  ) {
    throw new Error(
      `capability profile fragment "${expectedProviderId}": ${field} must be a subset of RecurringInterval`,
    );
  }
  return [...(value as RecurringInterval[])].sort();
}

/** Derive a provider's fragment from its declared capabilities. Pure. */
export function buildProfileFragment(
  providerId: string,
  capabilities: ProviderCapabilities,
): ProviderProfileFragment {
  const features = {} as Record<keyof ProviderFeatureFlags, boolean>;
  for (const k of FEATURE_FLAG_KEYS) features[k] = capabilities.features[k];
  return {
    providerId,
    features: features as ProviderFeatureFlags,
    recurrenceModel: capabilities.recurrenceModel,
    trialUnits: [...capabilities.trialUnits].sort(),
    recurringIntervals: [...capabilities.recurringIntervals].sort(),
  };
}

/** Canonical on-disk serialization (stable key order + trailing newline). */
export function serializeFragment(fragment: ProviderProfileFragment): string {
  const ordered = {
    providerId: fragment.providerId,
    recurrenceModel: fragment.recurrenceModel,
    features: Object.fromEntries(FEATURE_FLAG_KEYS.map((k) => [k, fragment.features[k]])),
    trialUnits: [...fragment.trialUnits].sort(),
    recurringIntervals: [...fragment.recurringIntervals].sort(),
  };
  return `${JSON.stringify(ordered, null, 2)}\n`;
}

/** Validate + normalize a parsed fragment against the contract. Throws on drift. */
export function parseProfileFragment(
  expectedProviderId: string,
  raw: unknown,
): ProviderProfileFragment {
  const f = raw as Partial<ProviderProfileFragment> | null;
  if (!f || typeof f !== 'object' || f.providerId !== expectedProviderId) {
    throw new Error(
      `capability profile fragment "${expectedProviderId}": missing or mismatched providerId`,
    );
  }
  if (!RECURRENCE_MODELS.includes(f.recurrenceModel as RecurrenceModel)) {
    throw new Error(
      `capability profile fragment "${expectedProviderId}": recurrenceModel must be 'price' | 'product'`,
    );
  }
  const feats = f.features as Record<string, unknown> | undefined;
  if (!feats || typeof feats !== 'object') {
    throw new Error(`capability profile fragment "${expectedProviderId}": missing features`);
  }
  for (const k of FEATURE_FLAG_KEYS) {
    if (typeof feats[k] !== 'boolean') {
      throw new Error(
        `capability profile fragment "${expectedProviderId}": features.${k} must be boolean`,
      );
    }
  }
  const extra = Object.keys(feats).filter((k) => !(FEATURE_FLAG_KEYS as string[]).includes(k));
  if (extra.length > 0) {
    throw new Error(
      `capability profile fragment "${expectedProviderId}": unknown feature keys ${extra.join(', ')}`,
    );
  }
  return {
    providerId: expectedProviderId,
    features: feats as unknown as ProviderFeatureFlags,
    recurrenceModel: f.recurrenceModel as RecurrenceModel,
    trialUnits: assertIntervalSubset(expectedProviderId, 'trialUnits', f.trialUnits),
    recurringIntervals: assertIntervalSubset(
      expectedProviderId,
      'recurringIntervals',
      f.recurringIntervals,
    ),
  };
}
