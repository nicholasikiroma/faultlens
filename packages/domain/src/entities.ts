import type {
  FailureClass,
  FeedbackRating,
  HandlerState,
  IncidentStatus,
  ProcessingState,
  SourceKind,
  TrustTier,
  VerificationState,
} from './states.ts';

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
  senderWaitMs: number | null;
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

export interface RuleMatch {
  failureClass: FailureClass;
  explanation: string;
  evidenceIds: readonly string[];
  certainty: 'observed' | 'inferred';
  severityHint?: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
}

export interface ClassificationRule {
  id: string;
  version: string;
  evaluate(ctx: Readonly<IncidentContext>): Promise<RuleMatch[]>;
}

export interface Feedback {
  id: string;
  workspaceId: string;
  findingId: string;
  actor: string;
  rating: FeedbackRating;
  note: string | null;
  createdAt: Date;
}

export interface IncidentStatusAuditEvent {
  id: string;
  workspaceId: string;
  actor: string;
  action: 'INCIDENT_STATUS_CHANGED';
  objectType: 'INCIDENT';
  objectId: string;
  oldState: IncidentStatus;
  newState: IncidentStatus;
  timestamp: Date;
}

export interface FindingRatedAuditEvent {
  id: string;
  workspaceId: string;
  actor: string;
  action: 'FINDING_RATED';
  objectType: 'FINDING';
  objectId: string;
  oldState: FeedbackRating | null;
  newState: FeedbackRating;
  timestamp: Date;
}

export type AuditEvent = IncidentStatusAuditEvent | FindingRatedAuditEvent;

