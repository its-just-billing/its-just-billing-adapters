import {
  ProviderAuthError,
  ProviderConflictError,
  ProviderConstraintError,
  ProviderError,
  ProviderNotFoundError,
  ProviderRateLimitError,
  ProviderUnavailableError,
} from '@its-just-billing/provider-sdk';
import Stripe from 'stripe';

function parseRetryAfter(err: Stripe.errors.StripeError): number | undefined {
  const header = err.headers?.['retry-after'] ?? err.headers?.['Retry-After'];
  if (typeof header !== 'string') return undefined;
  const n = Number(header);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

/**
 * Translate a thrown Stripe error into the normalized error hierarchy.
 *
 * Caller is responsible for the special case of "expected 404 on read" — those
 * methods (`get`, `archive`, `deactivate`, `activate`) check
 * `err.statusCode === 404` before calling this mapper and resolve `null`
 * instead of throwing.
 */
export function mapStripeError(err: unknown, methodLabel: string): ProviderError {
  if (!(err instanceof Stripe.errors.StripeError)) {
    return new ProviderError({
      status: 500,
      code: 'unknown',
      message: `${methodLabel}: ${err instanceof Error ? err.message : String(err)}`,
      cause: err,
    });
  }

  const message = `${methodLabel}: ${err.message ?? err.type}`;
  const providerCode = err.code ?? err.type;

  if (err instanceof Stripe.errors.StripeAuthenticationError) {
    return new ProviderAuthError({ status: 401, message, providerCode, cause: err });
  }
  if (err instanceof Stripe.errors.StripePermissionError) {
    return new ProviderAuthError({ status: 403, message, providerCode, cause: err });
  }
  if (err instanceof Stripe.errors.StripeRateLimitError) {
    const retryAfter = parseRetryAfter(err);
    return new ProviderRateLimitError({
      message,
      providerCode,
      cause: err,
      ...(retryAfter !== undefined ? { retryAfterSeconds: retryAfter } : {}),
    });
  }
  if (err instanceof Stripe.errors.StripeIdempotencyError) {
    return new ProviderConflictError({ message, providerCode, cause: err });
  }
  if (err instanceof Stripe.errors.StripeConnectionError) {
    return new ProviderUnavailableError({ status: 503, message, providerCode, cause: err });
  }
  if (err instanceof Stripe.errors.StripeAPIError) {
    return new ProviderUnavailableError({
      status: err.statusCode ?? 500,
      message,
      providerCode,
      cause: err,
    });
  }

  // Stripe encodes "you referenced something that doesn't exist" as a 400
  // with `code: 'resource_missing'`. Convert to ProviderNotFoundError so
  // contract callers can branch on the normalized hierarchy without
  // string-matching messages. Likewise `resource_already_exists` for
  // duplicate-id collisions (e.g. taking a promotion code that's already in
  // use) → ProviderConflictError.
  if (err.statusCode === 400 || err.statusCode === 422) {
    if (err.code === 'resource_missing') {
      return new ProviderNotFoundError({ message, providerCode, cause: err });
    }
    if (err.code === 'resource_already_exists') {
      return new ProviderConflictError({ message, providerCode, cause: err });
    }
  }

  switch (err.statusCode) {
    case 400:
    case 422:
      return new ProviderConstraintError({ message, providerCode, cause: err });
    case 401:
      return new ProviderAuthError({ status: 401, message, providerCode, cause: err });
    case 403:
      return new ProviderAuthError({ status: 403, message, providerCode, cause: err });
    case 404:
      return new ProviderNotFoundError({ message, providerCode, cause: err });
    case 409:
      return new ProviderConflictError({ message, providerCode, cause: err });
    case 429: {
      const retryAfter = parseRetryAfter(err);
      return new ProviderRateLimitError({
        message,
        providerCode,
        cause: err,
        ...(retryAfter !== undefined ? { retryAfterSeconds: retryAfter } : {}),
      });
    }
  }

  if (typeof err.statusCode === 'number' && err.statusCode >= 500) {
    return new ProviderUnavailableError({
      status: err.statusCode,
      message,
      providerCode,
      cause: err,
    });
  }

  return new ProviderError({
    status: err.statusCode ?? 500,
    code: 'unknown',
    message,
    providerCode,
    cause: err,
  });
}

/**
 * True when the thrown Stripe error represents "resource doesn't exist".
 * Stripe encodes this two ways: a 404 (when retrieving a non-existent id) or
 * a 400 with `code: 'resource_missing'` (when referencing a non-existent id
 * as a parameter to a write or list filter). Both should short-circuit
 * null-returning reads.
 */
export function isStripeNotFound(err: unknown): boolean {
  if (!(err instanceof Stripe.errors.StripeError)) return false;
  return err.statusCode === 404 || err.code === 'resource_missing';
}
