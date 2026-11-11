import type {
  DiagnosisDecision,
  Episode,
  FailureClass,
  ReplayGateReason,
} from './types.js';
import { DeliveryHistorySketch } from './crypto-sketch.js';

/**
 * Tail-Based Sampling & Root-Cause Diagnosis (`decide`)
 *
 * How this differs from general-purpose OpenTelemetry:
 *   - Instead of exporting spans piecemeal or using head-based random sampling
 *     (which drops rare webhook failures and floods storage with 99.9% healthy 200s),
 *     we collect one narrow `Episode` per webhook delivery.
 *   - When the episode seals, `decide(episode)` inspects the complete picture across
 *     socket, guard, controller, downstream `undici` calls, and async escapes.
 *   - If everything is healthy -> `shouldShip: false` (send nothing!).
 *   - If any layer failed (even if the handler swallowed a 401 and returned 200 OK!) ->
 *     `shouldShip: true` with an exact `primaryClass` and `autoReplaySafe` calculation.
 */

const defaultSketch = new DeliveryHistorySketch();

export interface DecideOptions {
  sketch?: DeliveryHistorySketch;
  signatureToleranceSec?: number;
  nowSec?: number;
}

export function decide(
  episode: Episode,
  options: DecideOptions = {}
): DiagnosisDecision {
  const sketch = options.sketch ?? defaultSketch;
  const toleranceSec = options.signatureToleranceSec ?? 300; // 5 minutes default
  const nowSec = options.nowSec ?? Math.floor(Date.now() / 1000);

  const evidenceChain: string[] = [];
  const detectedClasses: FailureClass[] = [];

  // 1. Check Deduplication & Ordering Sketch
  if (episode.encryption.scheme !== 'NONE') {
    if (episode.encryption.decryptedOk) {
      if (episode.encryption.plaintextEventId || episode.identity.eventId) {
        const id = episode.encryption.plaintextEventId || episode.identity.eventId!;
        const key = `${episode.identity.provider}:caseA_id:${id}`;
        episode.isDuplicateDelivery = sketch.checkAndRecordDuplicate(key);
        evidenceChain.push(
          `[Case A] Encrypted webhook deduplicated via plaintext eventId (${id})`
        );
      } else if (episode.encryption.plaintextDigestHmac) {
        const key = `${episode.identity.provider}:caseB_pt_hmac:${episode.encryption.plaintextDigestHmac}`;
        episode.isDuplicateDelivery = sketch.checkAndRecordDuplicate(key);
        evidenceChain.push(
          `[Case B] Encrypted webhook deduplicated via keyed plaintext HMAC (random IV ciphertext ignored)`
        );
      }
    }
  } else {
    // Unencrypted payload deduplication
    if (episode.identity.eventId) {
      const key = `${episode.identity.provider}:id:${episode.identity.eventId}`;
      episode.isDuplicateDelivery = sketch.checkAndRecordDuplicate(key);
    } else if (episode.bodyTap.wireBodyHmac) {
      const key = `${episode.identity.provider}:wire_hmac:${episode.bodyTap.wireBodyHmac}`;
      episode.isDuplicateDelivery = sketch.checkAndRecordDuplicate(key);
    }
  }

  // Provider timestamp ordering check
  if (
    episode.identity.resourceId &&
    episode.identity.providerCreatedAtSec !== undefined
  ) {
    const orderResult = sketch.checkAndRecordOrdering(
      `${episode.identity.provider}:${episode.identity.resourceId}`,
      episode.identity.providerCreatedAtSec
    );
    episode.isOutOfOrderDelivery = orderResult.isOutOfOrder;
    episode.lastSeenProviderTimestampSec = orderResult.lastSeenTimestampSec;
  }

  // 2. Evaluate Layer Evidence in Diagnostic Precedence Order

  // A. Signature Verification
  if (episode.verification.state === 'REJECTED') {
    detectedClasses.push('SIGNATURE_INVALID');
    evidenceChain.push(
      `Host Guard reported recordVerification({ state: 'REJECTED' })${
        episode.verification.reason ? ` (${episode.verification.reason})` : ''
      }`
    );
  } else if (episode.verification.state === 'VERIFIED') {
    evidenceChain.push(
      `Host Guard verified webhook signature (${episode.verification.provider ?? 'provider'})`
    );
  }

  // B. Payload Decryption
  if (episode.encryption.scheme !== 'NONE' && !episode.encryption.decryptedOk) {
    detectedClasses.push('DECRYPT_FAILURE');
    evidenceChain.push(
      `${episode.encryption.scheme} decryption failed with structural code: ${
        episode.encryption.errorCode ?? 'UNKNOWN'
      }`
    );
  }

  // C. Socket Ingress Abort / Timeout
  let timeoutAttribution: DiagnosisDecision['timeoutAttribution'];
  if (episode.socket.closeFired && !episode.socket.writableEndedAtClose) {
    detectedClasses.push('INGRESS_ABORTED');
    detectedClasses.push('NETWORK_TIMEOUT');

    if (
      episode.socket.eventLoopMaxLagMs >= 40 ||
      episode.socket.activeCpuBlockMs >= 40
    ) {
      timeoutAttribution = 'CPU_EVENT_LOOP_BLOCKED';
      evidenceChain.push(
        `Sender closed socket before response finished (writableEnded=false). Root cause: Synchronous CPU blocking (${episode.socket.activeCpuBlockMs}ms CPU / ${episode.socket.eventLoopMaxLagMs}ms loop lag)`
      );
    } else if (
      episode.downstreamCalls.some(
        (d) =>
          (d.durationMs ?? 0) >= 40 ||
          d.subHttpFailureType === 'SOCKET_TIMEOUT' ||
          d.statusCode === undefined
      )
    ) {
      timeoutAttribution = 'DOWNSTREAM_API_SLOW';
      evidenceChain.push(
        `Sender closed socket before response finished (writableEnded=false). Root cause: Slow downstream API call exceeded sender timeout`
      );
    } else {
      timeoutAttribution = 'CLIENT_EARLY_DISCONNECT';
      evidenceChain.push(
        `Sender closed socket early (writableEnded=false, headersSent=${episode.socket.headersSentAtClose})`
      );
    }

    if (episode.socket.committedAfterAbort) {
      evidenceChain.push(
        `Handler kept running and settled/committed AFTER sender hung up (committedAfterAbort=true)!`
      );
    }
  }

  // D. Downstream Outbound Calls via `diagnostics_channel` / `undici`
  for (const span of episode.downstreamCalls) {
    if (span.subHttpFailureType) {
      detectedClasses.push('DOWNSTREAM_NETWORK_ERROR');
      evidenceChain.push(
        `Outbound ${span.method} ${span.origin}${span.path} failed at network layer: ${span.subHttpFailureType} (${span.errorCode})`
      );
    } else if (span.statusCode === 401 || span.statusCode === 403) {
      detectedClasses.push('AUTH_FAILURE');
      evidenceChain.push(
        `Outbound ${span.method} ${span.origin}${span.path} returned ${span.statusCode} (attributed via ALS, even though host returned HTTP ${episode.statusCode ?? 'N/A'})`
      );
    } else if (span.statusCode === 429) {
      detectedClasses.push('RATE_LIMIT');
      evidenceChain.push(
        `Outbound ${span.method} ${span.origin}${span.path} hit 429 Rate Limit`
      );
    } else if (span.statusCode && span.statusCode >= 500) {
      detectedClasses.push('UPSTREAM_5XX');
      evidenceChain.push(
        `Outbound ${span.method} ${span.origin}${span.path} failed with ${span.statusCode}`
      );
    }
  }

  // E. Escaped Async Rejections & Uncaught Host Exceptions
  for (const ex of episode.exceptions) {
    if (
      ex.layer === 'UNCAUGHT_MONITOR' ||
      ex.layer === 'UNHANDLED_REJECTION' ||
      ex.escapedAfterResponse
    ) {
      detectedClasses.push('ASYNC_ESCAPE_FAILURE');
      evidenceChain.push(
        `Unawaited async operation escaped at ${ex.layer}: ${ex.name}: ${ex.message}`
      );
    } else {
      detectedClasses.push('UNHANDLED_EXCEPTION');
      evidenceChain.push(
        `Host exception observed at ${ex.layer}: ${ex.name}: ${ex.message}`
      );
    }
  }

  // Fallback if host returned 5xx without any recorded exception or downstream error
  if (
    detectedClasses.length === 0 &&
    episode.statusCode !== undefined &&
    episode.statusCode >= 500
  ) {
    detectedClasses.push('UNHANDLED_EXCEPTION');
    evidenceChain.push(
      `Host returned HTTP ${episode.statusCode} without explicit error record`
    );
  }

  // F. Out-of-Order & Duplicate Deliveries
  if (episode.isOutOfOrderDelivery) {
    detectedClasses.push('OUT_OF_ORDER');
    evidenceChain.push(
      `Event providerCreatedAt (${episode.identity.providerCreatedAtSec}) is older than already-processed timestamp (${episode.lastSeenProviderTimestampSec}) for resource ${episode.identity.resourceId}`
    );
  }

  if (episode.isDuplicateDelivery) {
    detectedClasses.push('DUPLICATE_DELIVERY');
    evidenceChain.push(
      `Duplicate retry detected in bounded delivery sketch for event ${
        episode.identity.eventId ?? episode.bodyTap.wireBodyHmac.slice(0, 12)
      }`
    );
  }

  // Deduplicate classes while preserving priority order
  const uniqueClasses = Array.from(new Set(detectedClasses));
  const primaryClass: FailureClass = uniqueClasses[0] ?? 'HEALTHY';
  const secondaryClasses = uniqueClasses.slice(1);

  // Tail-based sampling decision:
  // Send nothing when healthy; ship episode when any failure/anomaly class is present.
  const shouldShip = primaryClass !== 'HEALTHY';

  if (!shouldShip) {
    evidenceChain.push(
      `Delivery completed with HTTP ${episode.statusCode ?? 200} and healthy downstream spans -> Tail-sampler dropped episode.`
    );
  }

  // 3. Evaluate Auto-Replay Safety Gates
  const replayGateReasons: ReplayGateReason[] = [];

  if (episode.socket.committedAfterAbort) {
    replayGateReasons.push('committed-after-abort');
  }
  if (!episode.idempotency.handlerIdempotent) {
    replayGateReasons.push('handler-not-idempotent');
  }
  if (
    episode.verification.signatureTimestampSec !== undefined &&
    nowSec - episode.verification.signatureTimestampSec > toleranceSec
  ) {
    replayGateReasons.push('signature-likely-stale');
  }
  if (
    episode.verification.state === 'REJECTED' ||
    (episode.encryption.scheme !== 'NONE' &&
      !episode.encryption.authenticatesSender &&
      episode.verification.state !== 'VERIFIED')
  ) {
    replayGateReasons.push('sender-unauthenticated');
  }
  if (episode.isDuplicateDelivery) {
    replayGateReasons.push('duplicate-already-processed');
  }

  const autoReplaySafe = replayGateReasons.length === 0;

  const rootCauseSummary = buildRootCauseSummary(
    episode,
    primaryClass,
    timeoutAttribution
  );

  const decision: DiagnosisDecision = {
    shouldShip,
    primaryClass,
    secondaryClasses,
    rootCauseSummary,
    timeoutAttribution,
    autoReplaySafe,
    replayGateReasons,
    evidenceChain,
  };

  episode.sealed = true;
  episode.decision = decision;
  return decision;
}

function buildRootCauseSummary(
  episode: Episode,
  primary: FailureClass,
  timeoutAttribution?: DiagnosisDecision['timeoutAttribution']
): string {
  switch (primary) {
    case 'HEALTHY':
      return `Healthy delivery (${episode.method} ${episode.routeTemplate ?? episode.rawUrl} -> ${episode.statusCode ?? 200}). Not shipped.`;
    case 'AUTH_FAILURE': {
      const span = episode.downstreamCalls.find(
        (s) => s.statusCode === 401 || s.statusCode === 403
      );
      return `Downstream API authentication failed (${span?.method} ${span?.origin}${span?.path} -> ${span?.statusCode}) while host returned HTTP ${episode.statusCode ?? 'N/A'}.`;
    }
    case 'RATE_LIMIT': {
      const span = episode.downstreamCalls.find((s) => s.statusCode === 429);
      return `Downstream API rate-limited request (${span?.origin}${span?.path} -> 429) during webhook processing.`;
    }
    case 'UPSTREAM_5XX': {
      const span = episode.downstreamCalls.find(
        (s) => s.statusCode && s.statusCode >= 500
      );
      return `Downstream API server failure (${span?.origin}${span?.path} -> ${span?.statusCode}) caused webhook failure.`;
    }
    case 'DOWNSTREAM_NETWORK_ERROR': {
      const span = episode.downstreamCalls.find((s) => s.subHttpFailureType);
      return `Sub-HTTP network failure (${span?.subHttpFailureType}: ${span?.errorCode}) calling ${span?.origin}${span?.path}.`;
    }
    case 'INGRESS_ABORTED':
    case 'NETWORK_TIMEOUT':
      return `Webhook sender disconnected before response finished (writableEnded=false, attribution=${timeoutAttribution ?? 'UNKNOWN'}, committedAfterAbort=${episode.socket.committedAfterAbort}).`;
    case 'SIGNATURE_INVALID':
      return `Webhook signature rejected by host Guard (${episode.verification.reason ?? 'invalid HMAC'}).`;
    case 'DECRYPT_FAILURE':
      return `Encrypted webhook (${episode.encryption.scheme}) failed decryption with code ${episode.encryption.errorCode}.`;
    case 'ASYNC_ESCAPE_FAILURE': {
      const ex = episode.exceptions[0];
      return `Unawaited async operation rejected/threw after handler started (${ex?.layer}: ${ex?.message}).`;
    }
    case 'UNHANDLED_EXCEPTION': {
      const ex = episode.exceptions[0];
      return `Unhandled host exception in ${ex?.layer ?? 'HANDLER'}: ${ex?.message ?? `HTTP ${episode.statusCode}`}.`;
    }
    case 'OUT_OF_ORDER':
      return `Stale out-of-order webhook event for resource ${episode.identity.resourceId} (event created=${episode.identity.providerCreatedAtSec} < latest=${episode.lastSeenProviderTimestampSec}).`;
    case 'DUPLICATE_DELIVERY':
      return `Duplicate webhook retry delivery for event ${episode.identity.eventId ?? 'payload'}.`;
  }
}

