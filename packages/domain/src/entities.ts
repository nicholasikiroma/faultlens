import type {
  EpistemicStatus,
  FailureClass,
  FeedbackRating,
  HandlerState,
  HypothesisConfidence,
  HypothesisFeedbackRating,
  IncidentStatus,
  ProcessingState,
  RemediationKind,
  RunMode,
  RunState,
  SourceKind,
  ToolCallStatus,
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
  recordedAt?: Date | null;
  structuredDataJson?: unknown | null;
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

export interface RemediationProposal {
  kind: RemediationKind;
  summary: string;
  snippet: string;
  safetyNote: string;
}

export interface InvestigationSummary {
  knownSummary: string;
  suspectSummary: string;
  nextSafeCheckSummary: string;
}

export interface TokenUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface InvestigationRunRecord {
  id: string;
  workspaceId: string;
  incidentId: string;
  eventId: string | null;
  mode: RunMode;
  state: RunState;
  triggeredBy: string;
  triggerReason: string | null;
  modelId: string | null;
  promptVersion: string | null;
  rulesetVersion: string;
  tokenUsage: TokenUsage | null;
  toolCallCount: number;
  errorCode: string | null;
  errorMessage: string | null;
  summary: InvestigationSummary | null;
  startedAt: Date;
  endedAt: Date | null;
}

export interface ToolCallRecord {
  id: string;
  investigationRunId: string;
  workspaceId: string;
  stepIndex: number;
  toolName: string;
  safeArgumentsJson: unknown;
  resultEvidenceIds: readonly string[];
  resultSummary: string;
  status: ToolCallStatus;
  errorCode: string | null;
  startedAt: Date;
  endedAt: Date;
}

export interface HypothesisRecord {
  id: string;
  workspaceId: string;
  incidentId: string;
  investigationRunId: string;
  title: string;
  reasoning: string;
  epistemicStatus: EpistemicStatus;
  confidence: HypothesisConfidence;
  citedEvidenceIds: readonly string[];
  missingInformation: readonly string[];
  suggestedCheck: string;
  remediation: RemediationProposal | null;
  feedback: HypothesisFeedbackRating;
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

export interface HypothesisRatedAuditEvent {
  id: string;
  workspaceId: string;
  actor: string;
  action: 'HYPOTHESIS_RATED';
  objectType: 'HYPOTHESIS';
  objectId: string;
  oldState: HypothesisFeedbackRating | null;
  newState: HypothesisFeedbackRating;
  timestamp: Date;
}

export interface AiInvestigationRequestedAuditEvent {
  id: string;
  workspaceId: string;
  actor: string;
  action: 'AI_INVESTIGATION_REQUESTED';
  objectType: 'INVESTIGATION_RUN';
  objectId: string;
  oldState: RunState | null;
  newState: RunState;
  timestamp: Date;
}

export type AuditEvent =
  | IncidentStatusAuditEvent
  | FindingRatedAuditEvent
  | HypothesisRatedAuditEvent
  | AiInvestigationRequestedAuditEvent;
