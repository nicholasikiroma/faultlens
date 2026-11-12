export type FailureClass =
  | 'RATE_LIMIT'
  | 'SCHEMA_MISMATCH'
  | 'NETWORK_TIMEOUT'
  | 'INVALID_SIGNATURE'
  | 'HTTP_5XX'
  | 'DUPLICATE_DELIVERY'
  | 'OUT_OF_ORDER'
  | 'AUTH_FAILURE';

export type IncidentSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
export type IncidentStatus = 'OPEN' | 'INVESTIGATING' | 'RESOLVED' | 'IGNORED';
export type EpistemicType = 'OBSERVED' | 'RULE' | 'AI_HYPOTHESIS' | 'REDACTED';

export interface TimelineEvent {
  id: string;
  time: string;
  title: string;
  description: string;
  severity: 'normal' | 'warn' | 'danger';
  evidenceId: string;
}

export interface EvidenceItem {
  id: string;
  title: string;
  description: string;
  source: string;
  epistemic: EpistemicType;
  data: Record<string, unknown>;
}

export interface AttemptItem {
  id: string;
  attemptNumber: number;
  time: string;
  status: number;
  durationMs: number;
  evidenceId: string;
}

export interface RuleFinding {
  ruleId: string;
  name: string;
  description: string;
  matchedEvents: number;
}

export interface HypothesisItem {
  id: string;
  title: string;
  reasoning: string;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  suggestedCheck: string;
  feedback?: 'none' | 'helpful' | 'false_positive';
}

export interface Incident {
  id: string;
  key: string;
  title: string;
  integration: string;
  cls: FailureClass;
  events: number;
  severity: IncidentSeverity;
  status: IncidentStatus;
  seen: string;
  firstSeen: string;
  known: string;
  suspect: string;
  next: string;
  timeline: TimelineEvent[];
  evidence: EvidenceItem[];
  attempts: AttemptItem[];
  ruleFindings: RuleFinding[];
  hypotheses: HypothesisItem[];
  rawPayload: Record<string, unknown>;
}

export interface IntegrationItem {
  id: string;
  name: string;
  type: string;
  status: 'HEALTHY' | 'DEGRADED' | 'VALIDATION_ERRORS' | 'CRITICAL';
  failedAttempts: number;
  lastSeen: string;
}

export interface PlaygroundScenario {
  id: string;
  title: string;
  cls: FailureClass;
  description: string;
  samplePayload: Record<string, unknown>;
}

