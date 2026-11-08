export const FAILURE_CLASSES = [
  'AUTH_FAILURE',
  'RATE_LIMIT',
  'NETWORK_TIMEOUT',
  'UPSTREAM_5XX',
  'SCHEMA_MISMATCH',
  'INVALID_SIGNATURE',
  'DUPLICATE_DELIVERY',
  'OUT_OF_ORDER',
  'UNKNOWN',
] as const;

export type FailureClass = (typeof FAILURE_CLASSES)[number];

export type ProcessingState = 'RECEIVED' | 'QUEUED' | 'PROCESSED' | 'FAILED';
export type VerificationState = 'RECEIVED' | 'VERIFIED' | 'REJECTED';
export type HandlerState = 'PENDING' | 'PROCESSED' | 'FAILED';
export type SourceKind = 'DELIVERY_ATTEMPT' | 'WEBHOOK_EVENT' | 'FIXTURE';
export type IncidentStatus = 'OPEN' | 'INVESTIGATING' | 'RESOLVED' | 'ARCHIVED';
export type EpistemicStatus = 'OBSERVED' | 'INFERRED' | 'HYPOTHESIS' | 'UNVERIFIED';
export type RunMode = 'RULES' | 'AI_ASSISTED';
export type RunState =
  | 'NOT_STARTED'
  | 'QUEUED'
  | 'RUNNING'
  | 'NEEDS_REVIEW'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';
export type TrustTier = 'A' | 'B' | 'C';

export const INCIDENT_TRANSITIONS: Record<IncidentStatus, readonly IncidentStatus[]> = {
  OPEN: ['INVESTIGATING', 'RESOLVED', 'ARCHIVED'],
  INVESTIGATING: ['RESOLVED', 'ARCHIVED'],
  RESOLVED: ['ARCHIVED'],
  ARCHIVED: [],
};

export const FEEDBACK_RATINGS = ['USEFUL', 'INCORRECT'] as const;
export type FeedbackRating = (typeof FEEDBACK_RATINGS)[number];

export const AUDIT_ACTIONS = ['INCIDENT_STATUS_CHANGED', 'FINDING_RATED'] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const AUDIT_OBJECT_TYPES = ['INCIDENT', 'FINDING'] as const;
export type AuditObjectType = (typeof AUDIT_OBJECT_TYPES)[number];

export const AUDIT_OBJECT_TYPE = {
  INCIDENT_STATUS_CHANGED: 'INCIDENT',
  FINDING_RATED: 'FINDING',
} as const satisfies Record<AuditAction, AuditObjectType>;
