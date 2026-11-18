import type { DeliveryAttempt, Evidence, IncidentContext } from '#domain';

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function authFailures(ctx: Readonly<IncidentContext>): readonly DeliveryAttempt[] {
  return ctx.attempts.filter((attempt) => attempt.httpStatus === 401);
}

export function rateLimits(ctx: Readonly<IncidentContext>): readonly DeliveryAttempt[] {
  return ctx.attempts.filter((attempt) => attempt.httpStatus === 429);
}

export function networkTimeouts(ctx: Readonly<IncidentContext>): readonly DeliveryAttempt[] {
  return ctx.attempts.filter(
    (attempt) =>
      attempt.durationMs !== null &&
      attempt.senderWaitMs !== null &&
      attempt.durationMs >= 0 &&
      attempt.senderWaitMs > 0 &&
      attempt.durationMs >= attempt.senderWaitMs,
  );
}

export function upstreamFailures(ctx: Readonly<IncidentContext>): readonly DeliveryAttempt[] {
  return ctx.attempts.filter(
    (attempt) => attempt.httpStatus !== null && attempt.httpStatus >= 500 && attempt.httpStatus <= 599,
  );
}

export function schemaMismatches(ctx: Readonly<IncidentContext>): readonly DeliveryAttempt[] {
  return ctx.attempts.filter((attempt) => attempt.httpStatus === 400);
}

export function invalidSignatures(ctx: Readonly<IncidentContext>): readonly DeliveryAttempt[] {
  return ctx.attempts.filter((attempt) => attempt.verificationState === 'REJECTED');
}

export function duplicateDeliveries(ctx: Readonly<IncidentContext>): readonly DeliveryAttempt[] {
  const event = ctx.event;
  if (event === null || event.externalEventId === null) return [];
  const sameDigest = ctx.attempts.filter(
    (attempt) =>
      attempt.eventId === event.id &&
      attempt.verificationState === 'VERIFIED' &&
      attempt.errorCode !== 'conflict',
  );
  return sameDigest.length >= 2 ? sameDigest : [];
}

export function ingressAbortedEvidence(ctx: Readonly<IncidentContext>): readonly Evidence[] {
  return ctx.evidence.filter((item) => {
    if (item.sourceKind !== 'SOCKET_TIMING') return false;
    const data = asRecord(item.structuredDataJson);
    return data?.['closeFired'] === true && data?.['writableEndedAtClose'] === false;
  });
}

export function decryptFailureEvidence(ctx: Readonly<IncidentContext>): readonly Evidence[] {
  return ctx.evidence.filter((item) => {
    if (item.sourceKind !== 'FLIGHT_RECORDER_EPISODE') return false;
    const data = asRecord(item.structuredDataJson);
    const enc = asRecord(data?.['encryption']);
    return enc !== null && enc['scheme'] !== 'NONE' && enc['decryptedOk'] === false;
  });
}

export function downstreamNetworkErrorEvidence(ctx: Readonly<IncidentContext>): readonly Evidence[] {
  return ctx.evidence.filter((item) => {
    if (item.sourceKind !== 'DOWNSTREAM_SPAN') return false;
    const data = asRecord(item.structuredDataJson);
    return typeof data?.['subHttpFailureType'] === 'string' || typeof data?.['errorCode'] === 'string';
  });
}

export function asyncEscapeEvidence(ctx: Readonly<IncidentContext>): readonly Evidence[] {
  return ctx.evidence.filter((item) => {
    if (item.sourceKind !== 'HOST_EXCEPTION') return false;
    const data = asRecord(item.structuredDataJson);
    return data?.['escapedAfterResponse'] === true;
  });
}

export function unhandledExceptionEvidence(ctx: Readonly<IncidentContext>): readonly Evidence[] {
  return ctx.evidence.filter((item) => {
    if (item.sourceKind !== 'HOST_EXCEPTION') return false;
    const data = asRecord(item.structuredDataJson);
    return data?.['escapedAfterResponse'] !== true;
  });
}

export function outOfOrderEvidence(ctx: Readonly<IncidentContext>): {
  readonly matched: boolean;
  readonly evidenceIds: readonly string[];
  readonly detail: string | null;
} {
  const episodeHits = ctx.evidence.filter((item) => {
    if (item.sourceKind !== 'FLIGHT_RECORDER_EPISODE') return false;
    const data = asRecord(item.structuredDataJson);
    return data?.['isOutOfOrderDelivery'] === true;
  });
  if (episodeHits.length > 0) {
    return {
      matched: true,
      evidenceIds: episodeHits.map((e) => e.id),
      detail: 'FlightRecorder observed an out-of-order provider timestamp relative to previously seen events.',
    };
  }

  const event = ctx.event;
  const peers = ctx.peerEvents ?? [];
  if (event === null || event.occurredAt === null || peers.length === 0) {
    return { matched: false, evidenceIds: [], detail: null };
  }

  const newerDeliveredEarlier = peers.find(
    (peer) =>
      peer.id !== event.id &&
      peer.integrationId === event.integrationId &&
      (event.eventType === null || peer.eventType === null || peer.eventType === event.eventType) &&
      peer.occurredAt !== null &&
      peer.firstReceivedAt < event.firstReceivedAt &&
      peer.occurredAt > event.occurredAt!,
  );

  if (!newerDeliveredEarlier) {
    return { matched: false, evidenceIds: [], detail: null };
  }

  const evIds = ctx.evidence
    .filter(
      (item) =>
        (item.sourceKind === 'WEBHOOK_EVENT' && item.sourceRecordId === event.id) ||
        item.sourceKind === 'DELIVERY_ATTEMPT',
    )
    .map((item) => item.id);

  return {
    matched: true,
    evidenceIds: evIds,
    detail: `Event occurredAt (${event.occurredAt.toISOString()}) is older than previously received event ${newerDeliveredEarlier.id} (${newerDeliveredEarlier.occurredAt!.toISOString()}).`,
  };
}

export function anySpecific(ctx: Readonly<IncidentContext>): boolean {
  return (
    authFailures(ctx).length > 0 ||
    rateLimits(ctx).length > 0 ||
    networkTimeouts(ctx).length > 0 ||
    upstreamFailures(ctx).length > 0 ||
    schemaMismatches(ctx).length > 0 ||
    invalidSignatures(ctx).length > 0 ||
    duplicateDeliveries(ctx).length > 0 ||
    outOfOrderEvidence(ctx).matched ||
    ingressAbortedEvidence(ctx).length > 0 ||
    decryptFailureEvidence(ctx).length > 0 ||
    downstreamNetworkErrorEvidence(ctx).length > 0 ||
    unhandledExceptionEvidence(ctx).length > 0 ||
    asyncEscapeEvidence(ctx).length > 0
  );
}

export function attemptList(hits: readonly { id: string }[]): string {
  const ids = hits.map((attempt) => attempt.id).join(', ');
  return hits.length === 1 ? `attempt ${ids}` : `attempts ${ids}`;
}

export function evidenceIds(
  ctx: Readonly<IncidentContext>,
  attempts: readonly DeliveryAttempt[],
): readonly string[] {
  const sources = new Set(attempts.map((attempt) => attempt.id));
  return ctx.evidence.filter((item) => citesAttempt(item, sources)).map((item) => item.id);
}

function citesAttempt(item: Evidence, sources: ReadonlySet<string>): boolean {
  return (
    (item.sourceKind === 'DELIVERY_ATTEMPT' ||
      item.sourceKind === 'SOCKET_TIMING' ||
      item.sourceKind === 'DOWNSTREAM_SPAN' ||
      item.sourceKind === 'HOST_EXCEPTION') &&
    sources.has(item.sourceRecordId)
  );
}
