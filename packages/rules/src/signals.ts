import type { DeliveryAttempt, Evidence, IncidentContext } from '#domain';

export function authFailures(ctx: Readonly<IncidentContext>): readonly DeliveryAttempt[] {
  return ctx.attempts.filter((attempt) => attempt.httpStatus === 401);
}

export function rateLimits(ctx: Readonly<IncidentContext>): readonly DeliveryAttempt[] {
  return ctx.attempts.filter((attempt) => attempt.httpStatus === 429);
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

export function anySpecific(ctx: Readonly<IncidentContext>): boolean {
  return (
    authFailures(ctx).length > 0 ||
    rateLimits(ctx).length > 0 ||
    upstreamFailures(ctx).length > 0 ||
    schemaMismatches(ctx).length > 0 ||
    invalidSignatures(ctx).length > 0 ||
    duplicateDeliveries(ctx).length > 0
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
  return item.sourceKind === 'DELIVERY_ATTEMPT' && sources.has(item.sourceRecordId);
}
