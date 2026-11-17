export const FAILURE_CLASSES = [
  'AUTH_FAILURE',
  'RATE_LIMIT',
  'NETWORK_TIMEOUT',
  'UPSTREAM_5XX',
  'SCHEMA_MISMATCH',
  'INVALID_SIGNATURE',
  'DUPLICATE_DELIVERY',
  'OUT_OF_ORDER',
  'INGRESS_ABORTED',
  'DECRYPT_FAILURE',
  'DOWNSTREAM_NETWORK_ERROR',
  'UNHANDLED_EXCEPTION',
  'ASYNC_ESCAPE_FAILURE',
  'UNKNOWN',
] as const;

export type FailureClass = (typeof FAILURE_CLASSES)[number];

export const PROCESSING_STATES = ['RECEIVED', 'QUEUED', 'PROCESSED', 'FAILED'] as const;
export type ProcessingState = (typeof PROCESSING_STATES)[number];
export type VerificationState = 'RECEIVED' | 'VERIFIED' | 'REJECTED';
export type HandlerState = 'PENDING' | 'PROCESSED' | 'FAILED';

export const SOURCE_KINDS = [
  'DELIVERY_ATTEMPT',
  'WEBHOOK_EVENT',
  'FIXTURE',
  'FLIGHT_RECORDER_EPISODE',
  'DOWNSTREAM_SPAN',
  'HOST_EXCEPTION',
  'SOCKET_TIMING',
] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

export const INCIDENT_STATUSES = ['OPEN', 'INVESTIGATING', 'RESOLVED', 'ARCHIVED'] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

export const EPISTEMIC_STATUSES = ['OBSERVED', 'INFERRED', 'HYPOTHESIS', 'UNVERIFIED'] as const;
export type EpistemicStatus = (typeof EPISTEMIC_STATUSES)[number];

export const HYPOTHESIS_CONFIDENCES = ['HIGH', 'MEDIUM', 'LOW'] as const;
export type HypothesisConfidence = (typeof HYPOTHESIS_CONFIDENCES)[number];

export const REMEDIATION_KINDS = ['command', 'config_diff', 'code_pattern'] as const;
export type RemediationKind = (typeof REMEDIATION_KINDS)[number];

export type RunMode = 'RULES' | 'AI_ASSISTED';
export const RUN_STATES = [
  'NOT_STARTED',
  'QUEUED',
  'RUNNING',
  'NEEDS_REVIEW',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
] as const;
export type RunState = (typeof RUN_STATES)[number];
export type TrustTier = 'A' | 'B' | 'C';

export const TOOL_CALL_STATUSES = ['SUCCEEDED', 'FAILED', 'REJECTED'] as const;
export type ToolCallStatus = (typeof TOOL_CALL_STATUSES)[number];

export const INCIDENT_TRANSITIONS: Record<IncidentStatus, readonly IncidentStatus[]> = {
  OPEN: ['INVESTIGATING', 'RESOLVED', 'ARCHIVED'],
  INVESTIGATING: ['RESOLVED', 'ARCHIVED'],
  RESOLVED: ['ARCHIVED'],
  ARCHIVED: [],
};

export const FEEDBACK_RATINGS = ['USEFUL', 'INCORRECT'] as const;
export type FeedbackRating = (typeof FEEDBACK_RATINGS)[number];

export const HYPOTHESIS_FEEDBACK_RATINGS = ['USEFUL', 'INCORRECT', 'UNVERIFIED'] as const;
export type HypothesisFeedbackRating = (typeof HYPOTHESIS_FEEDBACK_RATINGS)[number];

export const AUDIT_ACTIONS = [
  'INCIDENT_STATUS_CHANGED',
  'FINDING_RATED',
  'HYPOTHESIS_RATED',
  'AI_INVESTIGATION_REQUESTED',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const AUDIT_OBJECT_TYPES = ['INCIDENT', 'FINDING', 'HYPOTHESIS', 'INVESTIGATION_RUN'] as const;
export type AuditObjectType = (typeof AUDIT_OBJECT_TYPES)[number];

export const AUDIT_OBJECT_TYPE = {
  INCIDENT_STATUS_CHANGED: 'INCIDENT',
  FINDING_RATED: 'FINDING',
  HYPOTHESIS_RATED: 'HYPOTHESIS',
  AI_INVESTIGATION_REQUESTED: 'INVESTIGATION_RUN',
} as const satisfies Record<AuditAction, AuditObjectType>;
