import type { ProcessingState, TrustTier } from './states.ts';

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
  verificationState: 'RECEIVED' | 'VERIFIED' | 'REJECTED';
  handlerState: 'PENDING' | 'PROCESSED' | 'FAILED';
  errorCode: string | null;
  correlationId: string;
}

export interface Evidence {
  id: string;
  sourceKind: 'DELIVERY_ATTEMPT' | 'WEBHOOK_EVENT' | 'FIXTURE';
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
