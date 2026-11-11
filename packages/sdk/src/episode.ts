import { AsyncLocalStorage } from 'node:async_hooks';
import crypto from 'node:crypto';
import type {
  Episode,
  HostLayer,
  IdentityFact,
  VerificationState,
} from './types.js';
import { safeTry, sanitizeHeaders } from './safe.js';
import { computeHmacSha256, isKnownDecryptError } from './crypto-sketch.js';

/**
 * AsyncLocalStorage (ALS) Episode Ownership Model
 *
 * Why ALS?
 * A Node.js server handles many concurrent webhook deliveries on a single thread,
 * interleaving execution at every `await`, stream event, and timer callback.
 * A global variable gets overwritten immediately by the next request.
 *
 * `AsyncLocalStorage` attaches an invisible label (the `Episode`) to the async execution
 * context created when the request enters our middleware. Every downstream `fetch` call,
 * Guard check, Controller method, and even unawaited background promise spawned inside
 * that request automatically inherits the right `Episode`.
 *
 * When host code (such as `recordVerification`) is called outside an instrumented
 * webhook route (e.g. in a unit test or CLI script), `als.getStore()` returns `undefined`
 * and the recorder safely becomes a no-op!
 */

const episodeStorage = new AsyncLocalStorage<Episode>();

let processMonitorsInstalled = false;

/**
 * Installs non-interfering process-level monitors (`uncaughtExceptionMonitor` and
 * `unhandledRejection`).
 *
 * Crucial Distinction:
 * Listening to `process.on('uncaughtException', ...)` CHANGES Node.js behavior by preventing
 * the process from crashing! In contrast, `process.on('uncaughtExceptionMonitor', ...)` is
 * purely observational: it lets the SDK record the fatal error onto the active ALS Episode
 * without altering Node's crash or exit semantics.
 */
export function ensureProcessMonitorsInstalled(): void {
  if (processMonitorsInstalled) return;
  processMonitorsInstalled = true;

  safeTry(() => {
    process.on('uncaughtExceptionMonitor', (err: Error) => {
      safeTry(() => {
        const ep = episodeStorage.getStore();
        if (!ep) return;
        ep.exceptions.push({
          layer: 'UNCAUGHT_MONITOR',
          name: err?.name || 'Error',
          message: err?.message || String(err),
          code: (err as { code?: string })?.code,
          escapedAfterResponse: ep.socket.closeFired || ep.socket.finishFired,
          recordedAtMs: Date.now(),
        });
      });
    });

    process.on('unhandledRejection', (reason: unknown) => {
      safeTry(() => {
        const ep = episodeStorage.getStore();
        if (!ep) return;
        const err = reason instanceof Error ? reason : new Error(String(reason));
        ep.exceptions.push({
          layer: 'UNHANDLED_REJECTION',
          name: err.name || 'UnhandledRejection',
          message: err.message,
          code: (err as { code?: string })?.code,
          escapedAfterResponse: ep.socket.closeFired || ep.socket.finishFired,
          recordedAtMs: Date.now(),
        });
      });
    });
  });
}

export interface CreateEpisodeParams {
  framework: Episode['framework'];
  method: string;
  rawUrl: string;
  headers: Record<string, string | string[] | undefined>;
}

export function createEpisode(params: CreateEpisodeParams): Episode {
  ensureProcessMonitorsInstalled();
  const now = Date.now();
  const cleanHeaders = sanitizeHeaders(params.headers);

  // Best-effort initial header identity extraction
  const initialIdentity = extractHeaderIdentity(cleanHeaders);

  return {
    episodeId: `ep_${crypto.randomBytes(6).toString('hex')}`,
    framework: params.framework,
    method: params.method || 'POST',
    rawUrl: params.rawUrl || '/',
    headers: cleanHeaders,
    verification: {
      state: 'UNOBSERVED',
      provider: initialIdentity.provider !== 'unknown' ? initialIdentity.provider : undefined,
      signatureTimestampSec: initialIdentity.signatureTimestampSec,
      recordedAtMs: now,
    },
    encryption: {
      scheme: 'NONE',
      authenticatesSender: false,
      decryptedOk: true,
    },
    identity: {
      provider: initialIdentity.provider,
      eventId: initialIdentity.eventId,
      eventType: initialIdentity.eventType,
    },
    idempotency: {
      handlerIdempotent: false,
      committedSideEffect: false,
    },
    downstreamCalls: [],
    exceptions: [],
    socket: {
      ingressReceivedAtMs: now,
      finishFired: false,
      closeFired: false,
      writableEndedAtClose: false,
      headersSentAtClose: false,
      handlerSettled: false,
      committedAfterAbort: false,
      eventLoopMaxLagMs: 0,
      activeCpuBlockMs: 0,
    },
    bodyTap: {
      totalBytesSeen: 0,
      tappedBytes: 0,
      truncatedByCap: false,
      wireBodyHmac: '',
    },
    isDuplicateDelivery: false,
    isOutOfOrderDelivery: false,
    sealed: false,
  };
}

/**
 * Extracts provider metadata available in standard webhook HTTP headers.
 */
function extractHeaderIdentity(headers: Record<string, string>): {
  provider: IdentityFact['provider'];
  eventId?: string;
  eventType?: string;
  signatureTimestampSec?: number;
} {
  if (headers['stripe-signature']) {
    const tMatch = headers['stripe-signature'].match(/(?:^|,\s*)t=(\d+)/);
    const signatureTimestampSec = tMatch ? Number(tMatch[1]) : undefined;
    return { provider: 'stripe', signatureTimestampSec };
  }
  if (headers['x-github-delivery'] || headers['x-hub-signature-256']) {
    return {
      provider: 'github',
      eventId: headers['x-github-delivery'],
      eventType: headers['x-github-event'],
    };
  }
  if (headers['x-shopify-webhook-id'] || headers['x-shopify-hmac-sha256']) {
    return {
      provider: 'shopify',
      eventId: headers['x-shopify-webhook-id'],
      eventType: headers['x-shopify-topic'],
    };
  }
  return { provider: 'unknown' };
}

/**
 * Runs `fn` inside the given `Episode`'s AsyncLocalStorage context.
 */
export function runInEpisode<T>(episode: Episode, fn: () => T): T {
  return episodeStorage.run(episode, fn);
}

/**
 * Binds a callback function so that whenever it is invoked later (e.g., from an
 * external queue worker, EventEmitter, or callback-style hook), it re-enters
 * the given `Episode`.
 */
export function bindToEpisode<T extends (...args: any[]) => any>(
  episode: Episode,
  fn: T
): T {
  return ((...args: Parameters<T>): ReturnType<T> =>
    episodeStorage.run(episode, () => fn(...args))) as T;
}

/**
 * Returns the active `Episode` for the current async execution chain, or `undefined`
 * if called outside an instrumented webhook request.
 */
export function getCurrentEpisode(): Episode | undefined {
  return episodeStorage.getStore();
}

// ============================================================================
// Public Host Recorder Functions (Deep-Module Surface)
// ============================================================================

/**
 * Called by the host's signature verification guard or middleware to report
 * whether the webhook signature check succeeded or failed.
 */
export function recordVerification(input: {
  state: Exclude<VerificationState, 'UNOBSERVED'>;
  provider?: string;
  signatureTimestampSec?: number;
  reason?: string;
}): void {
  safeTry(() => {
    const ep = episodeStorage.getStore();
    if (!ep) return;
    ep.verification = {
      state: input.state,
      provider: input.provider ?? ep.verification.provider ?? ep.identity.provider,
      signatureTimestampSec:
        input.signatureTimestampSec ?? ep.verification.signatureTimestampSec,
      reason: input.reason,
      recordedAtMs: Date.now(),
    };
  });
}

/**
 * Called by the host (or automatically by the body tap) to record extracted
 * webhook event identity and provider creation timestamp.
 */
export function recordIdentity(input: Partial<IdentityFact>): void {
  safeTry(() => {
    const ep = episodeStorage.getStore();
    if (!ep) return;
    if (input.provider) ep.identity.provider = input.provider;
    if (input.eventId) ep.identity.eventId = input.eventId;
    if (input.eventType) ep.identity.eventType = input.eventType;
    if (input.resourceId) ep.identity.resourceId = input.resourceId;
    if (input.providerCreatedAtSec !== undefined) {
      ep.identity.providerCreatedAtSec = input.providerCreatedAtSec;
    }
  });
}

/**
 * Called by the host when processing encrypted webhooks (AES-256-GCM or JWE).
 * Supports Case A (plaintext event ID) and Case B (keyed HMAC digest of plaintext)
 * without the SDK ever touching the decryption key.
 */
export function recordEncryption(input: {
  scheme: 'AES-256-GCM' | 'JWE';
  authenticatesSender: boolean;
  decryptedOk: boolean;
  decryptedPlaintext?: string | Buffer;
  plaintextEventId?: string;
  error?: unknown;
  digestKey?: string;
}): void {
  safeTry(() => {
    const ep = episodeStorage.getStore();
    if (!ep) return;
    let errorCode: string | undefined;
    if (!input.decryptedOk && input.error) {
      const classified = isKnownDecryptError(input.error);
      errorCode = classified.errorCode;
    }
    const plaintextDigestHmac =
      input.decryptedOk && input.decryptedPlaintext !== undefined
        ? computeHmacSha256(input.decryptedPlaintext, input.digestKey)
        : undefined;

    ep.encryption = {
      scheme: input.scheme,
      authenticatesSender: input.authenticatesSender,
      decryptedOk: input.decryptedOk,
      errorCode,
      plaintextDigestHmac,
      plaintextEventId: input.plaintextEventId,
    };
    if (input.plaintextEventId && !ep.identity.eventId) {
      ep.identity.eventId = input.plaintextEventId;
    }
  });
}

/**
 * Called by the host handler to declare whether its business logic is idempotent
 * and when a side effect has been committed.
 * If the socket had already aborted before this commit, the SDK automatically flags
 * `committedAfterAbort = true`!
 */
export function recordIdempotency(input: {
  handlerIdempotent?: boolean;
  committedSideEffect?: boolean;
}): void {
  safeTry(() => {
    const ep = episodeStorage.getStore();
    if (!ep) return;
    if (input.handlerIdempotent !== undefined) {
      ep.idempotency.handlerIdempotent = input.handlerIdempotent;
    }
    if (input.committedSideEffect) {
      ep.idempotency.committedSideEffect = true;
      if (ep.socket.closeFired && !ep.socket.writableEndedAtClose) {
        ep.socket.committedAfterAbort = true;
        ep.socket.handlerSettled = true;
        ep.socket.handlerSettledAtMs = Date.now();
      }
    }
  });
}

/**
 * Records an exception observed at a specific framework or host layer
 * without swallowing or altering the exception.
 */
export function recordError(
  err: unknown,
  layer: HostLayer = 'CONTROLLER'
): void {
  safeTry(() => {
    const ep = episodeStorage.getStore();
    if (!ep) return;
    const e = err instanceof Error ? err : new Error(String(err));
    ep.exceptions.push({
      layer,
      name: e.name || 'Error',
      message: e.message,
      code: (e as { code?: string })?.code,
      escapedAfterResponse: ep.socket.closeFired || ep.socket.finishFired,
      recordedAtMs: Date.now(),
    });
  });
}

