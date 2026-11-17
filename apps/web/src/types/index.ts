export type FailureClass =
  | 'RATE_LIMIT'
  | 'SCHEMA_MISMATCH'
  | 'NETWORK_TIMEOUT'
  | 'INVALID_SIGNATURE'
  | 'HTTP_5XX'
  | 'DUPLICATE_DELIVERY'
  | 'OUT_OF_ORDER'
  | 'AUTH_FAILURE'
  | 'INGRESS_ABORTED'
  | 'DECRYPT_FAILURE'
  | 'DOWNSTREAM_NETWORK_ERROR'
  | 'UNHANDLED_EXCEPTION'
  | 'ASYNC_ESCAPE_FAILURE'
  | 'UNKNOWN';

export type IncidentSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
export type IncidentStatus = 'OPEN' | 'INVESTIGATING' | 'RESOLVED' | 'IGNORED';
export type EpistemicType = 'OBSERVED' | 'RULE' | 'AI_HYPOTHESIS' | 'REDACTED';
export type HypothesisEpistemicStatus = 'OBSERVED' | 'INFERRED' | 'HYPOTHESIS' | 'UNVERIFIED';

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

export interface RemediationProposal {
  kind: 'command' | 'config_diff' | 'code_pattern';
  summary: string;
  snippet: string;
  safetyNote: string;
}

export interface HypothesisItem {
  id: string;
  title: string;
  reasoning: string;
  epistemicStatus?: HypothesisEpistemicStatus;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  citedEvidenceIds?: string[];
  missingInformation?: string[];
  suggestedCheck: string;
  remediation?: RemediationProposal | null;
  isPersisted?: boolean;
  feedback?: 'none' | 'helpful' | 'false_positive' | 'unverified';
}

export interface AgentRunSummary {
  id: string;
  mode: 'RULES' | 'AI_ASSISTED';
  state: 'NOT_STARTED' | 'QUEUED' | 'RUNNING' | 'NEEDS_REVIEW' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  triggeredBy: string;
  triggerReason: string | null;
  modelId: string | null;
  promptVersion: string | null;
  toolCallCount: number;
  errorCode: string | null;
  errorMessage: string | null;
  startedAt: string;
  endedAt: string | null;
}

export interface ToolCallSummary {
  id: string;
  investigationRunId: string;
  stepIndex: number;
  toolName: string;
  safeArgumentsJson: Record<string, unknown>;
  resultEvidenceIds: string[];
  resultSummary: string;
  status: 'SUCCEEDED' | 'FAILED' | 'REJECTED';
  errorCode: string | null;
  startedAt: string;
  endedAt: string;
}

export interface AgentSettingsSummary {
  enabled: boolean;
  autoInvestigate: boolean;
  provider: string;
  model: string;
  baseUrlConfigured: boolean;
  budgets: {
    maxToolCalls: number;
    maxDurationMs: number;
  };
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
  lastSeenTimestamp?: number;
  known: string;
  suspect: string;
  next: string;
  timeline: TimelineEvent[];
  evidence: EvidenceItem[];
  attempts: AttemptItem[];
  ruleFindings: RuleFinding[];
  hypotheses: HypothesisItem[];
  agentRuns?: AgentRunSummary[];
  toolCalls?: ToolCallSummary[];
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
