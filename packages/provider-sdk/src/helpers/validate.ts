import type { ZodError, ZodSchema } from 'zod';
import { ProviderValidationError, type ValidationIssue } from '../errors/validation.js';

function toValidationIssues(error: ZodError): ValidationIssue[] {
  return error.issues.map((issue) => ({
    path: [...issue.path],
    message: issue.message,
    code: issue.code,
  }));
}

/**
 * Parse `input` with the given schema. On failure, throws a normalized
 * ProviderValidationError carrying status 400 and per-issue details.
 *
 * Use this at the top of every public adapter method.
 */
export function validate<T>(schema: ZodSchema<T>, input: unknown, methodLabel: string): T {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  throw new ProviderValidationError({
    message: `Invalid input for ${methodLabel}`,
    issues: toValidationIssues(result.error),
    cause: result.error,
  });
}
