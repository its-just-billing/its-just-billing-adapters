import {
  ProviderAuthError,
  ProviderConflictError,
  ProviderConstraintError,
  ProviderError,
  ProviderNotFoundError,
  ProviderRateLimitError,
  ProviderUnavailableError,
} from '@its-just-billing/provider-sdk';
import { ApiError } from '@paddle/paddle-node-sdk';

/**
 * Paddle's `ApiError` carries no HTTP status — only a granular `code`, a
 * coarse `type` (`request_error` for 4xx-class, `api_error` for 5xx-class),
 * a `detail`, and an optional `retryAfter`. So we branch on `code`/`type`
 * rather than a status number.
 *
 * Caller is responsible for the "expected not-found on read" case: the
 * null-returning reads (`get`) call `isPaddleNotFound(err)` first and resolve
 * `null` instead of throwing.
 */
function codeMatches(code: string, ...needles: string[]): boolean {
  return needles.some((n) => code === n || code.endsWith(n) || code.includes(n));
}

export function mapPaddleError(err: unknown, methodLabel: string): ProviderError {
  if (!(err instanceof ApiError)) {
    return new ProviderError({
      status: 500,
      code: 'unknown',
      message: `${methodLabel}: ${err instanceof Error ? err.message : String(err)}`,
      cause: err,
    });
  }

  // Paddle attaches per-field reasons in `err.errors`; surface them so a
  // `ProviderConstraintError` says *why* the request was rejected instead of
  // an opaque "Invalid request." (also the only way to debug body mismatches
  // against the live sandbox).
  const fieldDetail =
    err.errors && err.errors.length > 0
      ? ` [${err.errors.map((e) => `${e.field}: ${e.message}`).join('; ')}]`
      : '';
  const message = `${methodLabel}: ${err.detail || err.code || err.type}${fieldDetail}`;
  const providerCode = err.code || err.type;
  const retryAfter =
    typeof err.retryAfter === 'number' && err.retryAfter >= 0 ? err.retryAfter : undefined;

  // Rate limiting MUST be classified before the `api_error` → unavailable
  // branch: Paddle surfaces a 429 as an `ApiError` with `type: 'api_error'`
  // (no granular `code`), so the only reliable signals are the parsed
  // `retryAfter` and the "rate limit" detail string. Misclassifying it as
  // `ProviderUnavailableError` loses the retry-after and the rate-limit
  // semantics callers branch on.
  if (isPaddleRateLimit(err)) {
    return new ProviderRateLimitError({
      message,
      providerCode,
      cause: err,
      ...(retryAfter !== undefined ? { retryAfterSeconds: retryAfter } : {}),
    });
  }

  // Server-side / transport class.
  if (err.type === 'api_error' || codeMatches(err.code, 'internal_error', 'service_unavailable')) {
    return new ProviderUnavailableError({ status: 503, message, providerCode, cause: err });
  }

  if (codeMatches(err.code, 'entity_not_found', 'not_found')) {
    return new ProviderNotFoundError({ message, providerCode, cause: err });
  }
  if (
    codeMatches(
      err.code,
      'authentication_missing',
      'authentication_malformed',
      'invalid_token',
      'invalid_api_key',
      'api_key',
      'unauthorized',
    )
  ) {
    return new ProviderAuthError({ status: 401, message, providerCode, cause: err });
  }
  if (codeMatches(err.code, 'forbidden', 'not_permitted', 'paddle_billing_not_enabled')) {
    return new ProviderAuthError({ status: 403, message, providerCode, cause: err });
  }
  if (codeMatches(err.code, 'conflict', 'already_exists', 'already_canceled', 'already_refunded')) {
    return new ProviderConflictError({ message, providerCode, cause: err });
  }

  // Everything else from `request_error` is a 4xx the caller's request
  // triggered — Paddle accepted the shape but rejected the operation
  // (invalid field, unprocessable state, bad reference). The SDK's
  // `validate()` already rejected malformed input upstream, so map the
  // residue to a constraint error rather than a generic 400.
  return new ProviderConstraintError({ message, providerCode, cause: err });
}

/**
 * True when the thrown Paddle error is a rate-limit (HTTP 429). Paddle's SDK
 * gives a 429 a generic `type: 'api_error'` with no specific `code`, so the
 * reliable signals are the parsed `retryAfter` (set from the `Retry-After`
 * header) and the "rate limit" detail string. Used both by `mapPaddleError`
 * (to classify) and the client retry wrapper (to back off and retry).
 */
export function isPaddleRateLimit(err: unknown): boolean {
  if (!(err instanceof ApiError)) return false;
  if (typeof err.retryAfter === 'number') return true;
  if (codeMatches(err.code, 'too_many_requests', 'rate_limit')) return true;
  const text = `${err.detail ?? ''} ${err.message ?? ''}`.toLowerCase();
  return text.includes('rate limit') || text.includes('too many requests');
}

/** The retry-after hint (seconds) Paddle parsed from the 429, if any. */
export function paddleRetryAfterSeconds(err: unknown): number | undefined {
  if (!(err instanceof ApiError)) return undefined;
  return typeof err.retryAfter === 'number' && err.retryAfter >= 0 ? err.retryAfter : undefined;
}

/**
 * True when Paddle rejected a mutation because the entity is already archived
 * ("… is archived and cannot be modified."). The SDK contract makes
 * `deactivate`/`archive` idempotent, so callers treat this as "already in the
 * target state" and return the current record instead of throwing.
 */
export function isPaddleAlreadyArchived(err: unknown): boolean {
  if (!(err instanceof ApiError)) return false;
  const text = `${err.detail ?? ''} ${err.message ?? ''}`.toLowerCase();
  return text.includes('is archived and cannot be modified');
}

/**
 * True when Paddle rejected a write because a referenced *product* id is
 * absent/ill-formed (`product_id` field error, or "URL invalid" on a
 * product-scoped path). `prices.create` maps this to `ProviderNotFoundError`
 * so an unknown `productId` surfaces as 404, per the SDK contract.
 */
export function isPaddleProductNotFound(err: unknown): boolean {
  if (!(err instanceof ApiError)) return false;
  if (isPaddleNotFound(err)) return true;
  return (err.errors ?? []).some((e) => e.field.toLowerCase().includes('product_id'));
}

/**
 * True when the thrown Paddle error means "this id doesn't exist". Used by
 * null-returning reads (`*.get`) to short-circuit to `null` instead of
 * surfacing a `ProviderNotFoundError`.
 */
export function isPaddleNotFound(err: unknown): boolean {
  if (!(err instanceof ApiError)) return false;
  if (
    err.code === 'entity_not_found' ||
    err.code === 'not_found' ||
    err.code.endsWith('_not_found')
  ) {
    return true;
  }
  // Paddle returns `detail: "URL called is invalid."` (no granular code) when
  // a well-formed call references an entity id that doesn't exist — the id
  // can't be resolved to a route, which is its not-found signal. (Kept
  // narrow — a broad "not found" substring match misclassifies unrelated
  // mutation errors that happen to contain the phrase.)
  const text = `${err.detail ?? ''} ${err.message ?? ''}`.toLowerCase();
  return text.includes('url called is invalid');
}

/**
 * True when Paddle rejected a call because a referenced id is unknown/ill-
 * formed. Some endpoints (subscriptions, transactions) report a bogus
 * `id`/`customer_id` as a `request_error` field error
 * (`[id: invalid input]`) rather than the "URL called is invalid." route
 * error. The SDK contract treats an unknown id on a read as not-found (→ null
 * / empty page) and on a throw-on-missing write as `ProviderNotFoundError`,
 * so subscription/payment methods use this wider check.
 */
export function isPaddleMissingReference(err: unknown): boolean {
  if (isPaddleNotFound(err)) return true;
  if (!(err instanceof ApiError)) return false;
  return (err.errors ?? []).some((e) => {
    const field = e.field.toLowerCase();
    return (
      (field === 'id' || field === 'customer_id' || field.endsWith('_id')) &&
      e.message.toLowerCase().includes('invalid input')
    );
  });
}
