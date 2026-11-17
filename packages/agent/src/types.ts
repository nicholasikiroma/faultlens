import type {
  DeliveryAttempt,
  EpistemicStatus,
  Evidence,
  FailureClass,
  HypothesisConfidence,
  IncidentStatus,
  InvestigationSummary,
  RemediationProposal,
  RunState,
  TokenUsage,
  ToolCallStatus,
  WebhookEvent,
} from '#domain';

export interface AgentBudgets {
  readonly maxToolCalls: number;
  readonly maxDurationMs: number;
  readonly maxInputChars: number;
  readonly maxToolResultChars: number;
  readonly maxHypotheses: number;
}

export const DEFAULT_AGENT_BUDGETS: AgentBudgets = {
  maxToolCalls: 8,
  maxDurationMs: 60_000,
  maxInputChars: 48_000,
  maxToolResultChars: 6_000,
  maxHypotheses: 4,
};

export interface IncidentRecordView {
  readonly id: string;
  readonly workspaceId: string;
  readonly fingerprint: string;
  readonly integrationId: string;
  readonly environment: string;
  readonly failureClass: FailureClass;
  readonly endpoint: string;
  readonly ruleVersion: string;
  readonly status: IncidentStatus;
  readonly firstSeenAt: Date;
  readonly lastSeenAt: Date;
  readonly eventCount: number;
}

export interface FindingRecordView {
  readonly id: string;
  readonly eventId: string;
  readonly ruleId: string;
  readonly ruleVersion: string;
  readonly failureClass: FailureClass;
  readonly explanation: string;
  readonly certainty: string;
  readonly evidenceIds: readonly string[];
}

export interface IntegrationConfigSummaryView {
  readonly id: string;
  readonly workspaceId: string;
  readonly environment: string;
  readonly endpoint: string;
  readonly hasSigningSecret: boolean;
  readonly activeIngestKeyCount: number;
}

/**
 * Strictly read-only, workspace-scoped data access contract for the agent's tools.
 * Implementations MUST enforce `workspaceId` on every query and NEVER return secrets.
 */
export interface AgentToolRepository {
  getIncident(workspaceId: string, incidentId: string): Promise<IncidentRecordView | null>;
  listIncidentEventsAndAttempts(
    workspaceId: string,
    incidentId: string,
    limit: number,
  ): Promise<{
    readonly events: readonly WebhookEvent[];
    readonly attempts: readonly DeliveryAttempt[];
  }>;
  getEvidenceByIds(workspaceId: string, evidenceIds: readonly string[]): Promise<readonly Evidence[]>;
  searchRelatedEvents(
    workspaceId: string,
    query: {
      readonly integrationId?: string;
      readonly traceId?: string;
      readonly from?: Date;
      readonly to?: Date;
      readonly limit: number;
    },
  ): Promise<readonly WebhookEvent[]>;
  getIntegrationConfigSummary(
    workspaceId: string,
    integrationId: string,
  ): Promise<IntegrationConfigSummaryView | null>;
  listRuleFindings(workspaceId: string, incidentId: string): Promise<readonly FindingRecordView[]>;
}

export interface ToolJsonSchema {
  readonly type: 'object';
  readonly properties: Readonly<Record<string, unknown>>;
  readonly required?: readonly string[];
  readonly additionalProperties?: boolean;
}

export interface AgentToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly parameters: ToolJsonSchema;
}

export interface ModelToolCallRequest {
  readonly id: string;
  readonly name: string;
  readonly arguments: Record<string, unknown>;
}

export type ChatMessage =
  | { readonly role: 'system'; readonly content: string }
  | { readonly role: 'user'; readonly content: string }
  | {
      readonly role: 'assistant';
      readonly content: string | null;
      readonly toolCalls?: readonly ModelToolCallRequest[];
    }
  | {
      readonly role: 'tool';
      readonly toolCallId: string;
      readonly toolName: string;
      readonly content: string;
    };

export interface ModelTurnResponse {
  readonly content: string | null;
  readonly toolCalls: readonly ModelToolCallRequest[];
  readonly usage?: TokenUsage;
  readonly modelId?: string;
}

export interface ModelProvider {
  readonly id: string;
  readonly model: string;
  completeWithTools(input: {
    readonly messages: readonly ChatMessage[];
    readonly tools: readonly AgentToolDefinition[];
    readonly signal?: AbortSignal;
  }): Promise<ModelTurnResponse>;
}

export interface AgentHypothesisOutput {
  readonly title: string;
  readonly reasoning: string;
  readonly epistemicStatus: EpistemicStatus;
  readonly confidence: HypothesisConfidence;
  readonly citedEvidenceIds: readonly string[];
  readonly missingInformation: readonly string[];
  readonly suggestedCheck: string;
  readonly remediation: RemediationProposal | null;
}

export interface AgentDiagnosisOutput extends InvestigationSummary {
  readonly hypotheses: readonly AgentHypothesisOutput[];
}

export interface AgentToolCallLog {
  readonly stepIndex: number;
  readonly toolName: string;
  readonly safeArgumentsJson: Record<string, unknown>;
  readonly resultEvidenceIds: readonly string[];
  readonly resultSummary: string;
  readonly status: ToolCallStatus;
  readonly errorCode: string | null;
  readonly startedAt: Date;
  readonly endedAt: Date;
}

export interface AgentRunResult {
  readonly state: Extract<RunState, 'COMPLETED' | 'NEEDS_REVIEW' | 'FAILED'>;
  readonly modelId: string;
  readonly promptVersion: string;
  readonly tokenUsage: TokenUsage;
  readonly toolCalls: readonly AgentToolCallLog[];
  readonly output: AgentDiagnosisOutput | null;
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
}
