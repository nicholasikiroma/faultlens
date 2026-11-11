import type { IncomingHttpHeaders } from 'node:http';

/**
 * Fail-Open & Non-Interference Utilities
 *
 * Core Engineering Rule:
 * An observability or diagnostic SDK must NEVER crash the host application,
 * alter control flow, or mutate request/response objects. Every SDK hook,
 * stream listener, diagnostics_channel subscriber, and exporter is wrapped
 * in `safeTry`.
 */

const SENSITIVE_HEADER_NAMES = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
]);

/**
 * Executes an internal SDK operation inside a fail-open boundary.
 * If `fn` throws synchronously, the error is swallowed and `fallback` is returned.
 */
export function safeTry<T>(fn: () => T, fallback?: T): T | undefined {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

/**
 * Creates a shallow, sanitized copy of incoming HTTP headers.
 * Never mutates the original `req.headers` object.
 */
export function sanitizeHeaders(
  headers: IncomingHttpHeaders | Record<string, string | string[] | undefined>
): Record<string, string> {
  const clean: Record<string, string> = {};
  safeTry(() => {
    for (const [rawKey, rawVal] of Object.entries(headers || {})) {
      if (rawVal === undefined) continue;
      const key = rawKey.toLowerCase();
      if (SENSITIVE_HEADER_NAMES.has(key)) {
        clean[key] = '[REDACTED]';
      } else {
        clean[key] = Array.isArray(rawVal) ? rawVal.join(', ') : String(rawVal);
      }
    }
  });
  return clean;
}

