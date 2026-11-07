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
