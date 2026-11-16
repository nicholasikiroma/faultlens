/**
 * Core Type Definitions for the FaultLens Webhook Flight-Recorder SDK.
 *
 * Design Principle (Ousterhout's "Deep Modules"):
 * The public API surface exposed to the host application is tiny, while the
 * internal Episode representation aggregates rich, multi-layer evidence from:
 *   1. AsyncLocalStorage (episode context)
 *   2. diagnostics_channel / undici (outbound HTTP & sub-HTTP calls)
 *   3. ServerResponse close/finish & perf_hooks (timeouts, aborts, CPU vs network wait)
 *   4. Passive stream tap (body digest & identity extraction without backpressure/OOM)
 *   5. Framework lifecycle hooks (route templates, guards, RxJS interceptors)
 *   6. Webhook provider rules (signatures, timestamps, duplicates, ordering, idempotency)
 *   7. Tail-based sampling (`decide`)
 *   8. Encryption & keyed hashing (AES-GCM/JWE, HMAC-SHA256, KNOWN_ERRORS)
 */

export type VerificationState = 'UNOBSERVED' | 'VERIFIED' | 'REJECTED';

export interface VerificationFact {
  state: VerificationState;
  provider?: string;
  /** Provider signature timestamp (e.g., Stripe `t=1700000000` in seconds) */
  signatureTimestampSec?: number;
  reason?: string;
  recordedAtMs: number;
}

export interface EncryptionFact {
  scheme: 'AES-256-GCM' | 'JWE' | 'NONE';
  /**
   * Encryption != Authentication unless the key is a shared secret (symmetric)
   * or paired with a verified signature. Public-key encryption alone allows anyone
   * with the public key to craft ciphertexts (`authenticatesSender: false`).
   */
  authenticatesSender: boolean;
  decryptedOk: boolean;
  errorCode?: string;
  /**
   * Because AES-GCM / JWE uses a random IV per delivery, identical retried events
   * produce different wire ciphertexts. Deduplication MUST use either the plaintext
   * event ID (Case A) or a keyed HMAC digest of the decrypted plaintext (Case B).
   */
  plaintextDigestHmac?: string;
  plaintextEventId?: string;
}

export interface IdentityFact {
  provider: 'stripe' | 'github' | 'shopify' | 'custom' | 'unknown';
  eventId?: string;
  eventType?: string;
  /** Resource identifier (e.g. customer or invoice ID) used for OUT_OF_ORDER tracking */
  resourceId?: string;
  /** Provider-generated event creation timestamp (seconds), NOT host arrival time */
  providerCreatedAtSec?: number;
}

export type SubHttpFailureType =
  | 'DNS_FAILURE'
  | 'TCP_REFUSED'
  | 'TLS_ERROR'
  | 'SOCKET_TIMEOUT'
  | 'UNKNOWN_NETWORK_ERROR';

export interface DownstreamSpan {
  spanId: string;
  method: string;
  origin: string;
  path: string;
  startedAtMs: number;
  durationMs?: number;
  statusCode?: number;
  errorCode?: string;
  errorMessage?: string;
  subHttpFailureType?: SubHttpFailureType;
}

export interface SocketAndTimingFacts {
  ingressReceivedAtMs: number;
  finishFired: boolean;
  finishAtMs?: number;
  closeFired: boolean;
  closeAtMs?: number;
  /**
   * When `close` fires with `writableEnded: false`, the webhook sender hung up
   * before the host finished sending a response (`INGRESS_ABORTED` / timeout).
   */
  writableEndedAtClose: boolean;
  headersSentAtClose: boolean;
  /** Whether the host handler's promise/execution chain eventually completed */
  handlerSettled: boolean;
  handlerSettledAtMs?: number;
  /**
   * TRUE if the host handler committed a side-effect (or settled normally) AFTER
   * the webhook sender had already aborted the socket. Replaying this webhook is dangerous!
   */
  committedAfterAbort: boolean;
  /** Measured event-loop delay or synchronous CPU block duration during the episode */
  eventLoopMaxLagMs: number;
  activeCpuBlockMs: number;
}

export interface BodyTapFacts {
  totalBytesSeen: number;
  tappedBytes: number;
  truncatedByCap: boolean;
  /**
   * Keyed HMAC-SHA256 of the wire payload (never plain SHA-256, because small
   * webhook payloads can be brute-forced against an unkeyed hash).
   */
  wireBodyHmac: string;
  previewJson?: Record<string, unknown>;
  /** Snapshot buffer of the body (up to maxTapBytes) for export / delivery */
  capturedBytes?: Buffer;
}

export type HostLayer =
  | 'MIDDLEWARE'
  | 'GUARD'
  | 'INTERCEPTOR'
  | 'CONTROLLER'
  | 'ERROR_FILTER'
  | 'UNCAUGHT_MONITOR'
  | 'UNHANDLED_REJECTION';

export interface HostExceptionFact {
  layer: HostLayer;
  name: string;
  message: string;
  code?: string;
  escapedAfterResponse: boolean;
  recordedAtMs: number;
}

export interface IdempotencyFact {
  handlerIdempotent: boolean;
  committedSideEffect: boolean;
}

export type FailureClass =
  | 'HEALTHY'
  | 'INGRESS_ABORTED'
  | 'NETWORK_TIMEOUT'
  | 'SIGNATURE_INVALID'
  | 'DECRYPT_FAILURE'
  | 'AUTH_FAILURE'
  | 'RATE_LIMIT'
  | 'UPSTREAM_5XX'
  | 'DOWNSTREAM_NETWORK_ERROR'
  | 'UNHANDLED_EXCEPTION'
  | 'ASYNC_ESCAPE_FAILURE'
  | 'OUT_OF_ORDER'
  | 'DUPLICATE_DELIVERY';

export type ReplayGateReason =
  | 'signature-likely-stale'
  | 'committed-after-abort'
  | 'handler-not-idempotent'
  | 'sender-unauthenticated'
  | 'duplicate-already-processed';

export interface DiagnosisDecision {
  /** Tail-based sampling: false when HEALTHY (nothing sent), true on any failure/anomaly */
  shouldShip: boolean;
  primaryClass: FailureClass;
  secondaryClasses: FailureClass[];
  rootCauseSummary: string;
  timeoutAttribution?:
    | 'CPU_EVENT_LOOP_BLOCKED'
    | 'DOWNSTREAM_API_SLOW'
    | 'CLIENT_EARLY_DISCONNECT';
  autoReplaySafe: boolean;
  replayGateReasons: ReplayGateReason[];
  /** Educational trace mapping each finding back to the curriculum resources */
  evidenceChain: string[];
}

export interface Episode {
  episodeId: string;
  framework: 'node-http' | 'express' | 'fastify' | 'hono' | 'nestjs' | 'custom';
  method: string;
  rawUrl: string;
  /** Matched route template (e.g., `/webhooks/:provider`), often populated at seal time */
  routeTemplate?: string;
  /** Sanitized request headers (sensitive values like Authorization are redacted) */
  headers: Record<string, string>;
  statusCode?: number;
  verification: VerificationFact;
  encryption: EncryptionFact;
  identity: IdentityFact;
  idempotency: IdempotencyFact;
  downstreamCalls: DownstreamSpan[];
  exceptions: HostExceptionFact[];
  socket: SocketAndTimingFacts;
  bodyTap: BodyTapFacts;
  isDuplicateDelivery: boolean;
  isOutOfOrderDelivery: boolean;
  lastSeenProviderTimestampSec?: number;
  sealed: boolean;
  decision?: DiagnosisDecision;
}

export interface FlightRecorderOptions {
  /** Ephemeral or host-configured HMAC key used ONLY for hashing digests (never signing secrets) */
  digestKey?: string;
  /** Maximum bytes buffered by the passive stream tap for identity extraction (default: 64KB) */
  maxTapBytes?: number;
  /** Signature staleness threshold in seconds (default: 300s / 5 minutes like Stripe) */
  signatureToleranceSec?: number;
  /** Callback invoked when an episode is sealed and `decide()` determines it should ship (or always if observeAllInHook is true) */
  onEpisodeSealed?: (episode: Episode, decision: DiagnosisDecision) => void | Promise<void>;
  /** Set true in labs/tests to inspect even HEALTHY episodes before tail-dropping */
  observeAllInHook?: boolean;
}

