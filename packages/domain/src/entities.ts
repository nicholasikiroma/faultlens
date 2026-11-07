import type { HandlerState, ProcessingState, SourceKind, TrustTier, VerificationState } from './states.ts';

export interface WebhookEvent {
  id: string;
  integrationId: string;
  externalEventId: string | null;
  eventType: string | null;
  occurredAt: Date | null;
  firstReceivedAt: Date;
  traceId: string | null;
  payloadDigest: string;
  redactedPayloadJson: unknown | null;
  processingState: ProcessingState;
}

export interface DeliveryAttempt {
  id: string;
  eventId: string | null;
  integrationId: string;
  receivedAt: Date;
  httpStatus: number | null;
  durationMs: number | null;
  verificationState: VerificationState;
  handlerState: HandlerState;
  errorCode: string | null;
  correlationId: string;
}

export interface Evidence {
  id: string;
  sourceKind: SourceKind;
  sourceRecordId: string;
  summary: string;
  sha256Digest: string;
  trustTier: TrustTier;
}

export interface IncidentContext {
  integrationId: string;
  environment: string;
  event: WebhookEvent | null;
  attempts: readonly DeliveryAttempt[];
  evidence: readonly Evidence[];
}
