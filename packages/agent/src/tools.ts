import type {
  AgentToolDefinition,
  AgentToolRepository,
  IntegrationConfigSummaryView,
} from './types.ts';
import { capJsonString, redactUnknown, wrapUntrustedText } from './guardrails.ts';

export const ALLOWLISTED_TOOLS: readonly AgentToolDefinition[] = [
  {
    name: 'get_incident',
    description:
      'Fetch the current incident metadata, fingerprint components, lifecycle status, failure class, and event count.',
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'list_event_attempts',
    description:
      'List events and delivery attempts linked to the current incident, including status codes, durations, error codes, and trace IDs.',
    parameters: {
      type: 'object',
      properties: {
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: 25,
          description: 'Maximum number of recent events to inspect (1..25, default 10).',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_evidence',
    description:
      'Fetch specific evidence records by ID, including FlightRecorder spans, socket timings, host exceptions, and summaries.',
    parameters: {
      type: 'object',
      properties: {
        evidenceIds: {
          type: 'array',
          items: { type: 'string' },
          minItems: 1,
          maxItems: 15,
          description: 'Array of evidence UUIDs to inspect.',
        },
      },
      required: ['evidenceIds'],
      additionalProperties: false,
    },
  },
  {
    name: 'search_related_events',
    description:
      'Search recent events in the same workspace by integrationId, traceId, or time window around the incident to spot cascading failures.',
    parameters: {
      type: 'object',
      properties: {
        integrationId: { type: 'string' },
        traceId: { type: 'string' },
        windowMinutes: { type: 'integer', minimum: 1, maximum: 180 },
        limit: { type: 'integer', minimum: 1, maximum: 20 },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_integration_config_summary',
    description:
      'Inspect non-secret configuration metadata for an integration in the same workspace (environment, endpoint, active ingest key count).',
    parameters: {
      type: 'object',
      properties: {
        integrationId: { type: 'string' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_rule_findings',
    description:
      'Read all deterministic rule-engine findings and their cited evidence IDs already recorded for this incident.',
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
] as const;

const TOOL_NAMES = new Set(ALLOWLISTED_TOOLS.map((t) => t.name));

export interface ToolExecutionOutcome {
  readonly status: 'SUCCEEDED' | 'FAILED' | 'REJECTED';
  readonly errorCode: string | null;
  readonly safeArguments: Record<string, unknown>;
  readonly evidenceIds: readonly string[];
  readonly summary: string;
  readonly serializedContent: string;
}

export async function executeAllowlistedTool(input: {
  readonly toolName: string;
  readonly rawArguments: Record<string, unknown>;
  readonly workspaceId: string;
  readonly incidentId: string;
  readonly repo: AgentToolRepository;
  readonly maxToolResultChars: number;
}): Promise<ToolExecutionOutcome> {
  const safeArguments = (redactUnknown(input.rawArguments) ?? {}) as Record<string, unknown>;

  if (!TOOL_NAMES.has(input.toolName)) {
    const payload = { error: 'unknown_or_disallowed_tool', toolName: input.toolName };
    return {
      status: 'REJECTED',
      errorCode: 'UNKNOWN_TOOL',
      safeArguments,
      evidenceIds: [],
      summary: `Rejected unknown tool "${input.toolName}"`,
      serializedContent: JSON.stringify(payload),
    };
  }

  try {
    switch (input.toolName) {
      case 'get_incident': {
        const incident = await input.repo.getIncident(input.workspaceId, input.incidentId);
        if (!incident) {
          return notFoundOutcome(safeArguments, 'Incident not found in workspace');
        }
        const payload = {
          id: incident.id,
          integrationId: incident.integrationId,
          environment: incident.environment,
          endpoint: incident.endpoint,
          failureClass: incident.failureClass,
          status: incident.status,
          ruleVersion: incident.ruleVersion,
          eventCount: incident.eventCount,
          firstSeenAt: incident.firstSeenAt.toISOString(),
          lastSeenAt: incident.lastSeenAt.toISOString(),
        };
        return {
          status: 'SUCCEEDED',
          errorCode: null,
          safeArguments,
          evidenceIds: [],
          summary: `Loaded incident ${incident.failureClass} (${incident.eventCount} events)`,
          serializedContent: capJsonString(payload, input.maxToolResultChars),
        };
      }

      case 'list_event_attempts': {
        const limit = clampInt(input.rawArguments['limit'], 1, 25, 10);
        const { events, attempts } = await input.repo.listIncidentEventsAndAttempts(
          input.workspaceId,
          input.incidentId,
          limit,
        );
        const payload = {
          events: events.map((ev) => ({
            id: ev.id,
            integrationId: ev.integrationId,
            externalEventId: ev.externalEventId,
            eventType: ev.eventType,
            occurredAt: ev.occurredAt?.toISOString() ?? null,
            firstReceivedAt: ev.firstReceivedAt.toISOString(),
            traceId: ev.traceId,
            processingState: ev.processingState,
            redactedPayloadPreview:
              ev.redactedPayloadJson !== null
                ? wrapUntrustedText(JSON.stringify(redactUnknown(ev.redactedPayloadJson)), 'B')
                : null,
          })),
          attempts: attempts.map((att) => ({
            id: att.id,
            eventId: att.eventId,
            receivedAt: att.receivedAt.toISOString(),
            httpStatus: att.httpStatus,
            durationMs: att.durationMs,
            senderWaitMs: att.senderWaitMs,
            verificationState: att.verificationState,
            handlerState: att.handlerState,
            errorCode: att.errorCode,
            correlationId: att.correlationId,
          })),
        };
        return {
          status: 'SUCCEEDED',
          errorCode: null,
          safeArguments: { limit },
          evidenceIds: [],
          summary: `Listed ${events.length} event(s) and ${attempts.length} attempt(s)`,
          serializedContent: capJsonString(payload, input.maxToolResultChars),
        };
      }

      case 'get_evidence': {
        const rawIds = input.rawArguments['evidenceIds'];
        if (!Array.isArray(rawIds) || rawIds.length === 0) {
          return invalidArgsOutcome(safeArguments, 'evidenceIds must be a non-empty string array');
        }
        const ids = rawIds
          .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
          .slice(0, 15);
        if (ids.length === 0) {
          return invalidArgsOutcome(safeArguments, 'evidenceIds contained no valid string IDs');
        }
        const rows = await input.repo.getEvidenceByIds(input.workspaceId, ids);
        const evidenceIds = rows.map((row) => row.id);
        const payload = {
          evidence: rows.map((row) => ({
            id: row.id,
            sourceKind: row.sourceKind,
            sourceRecordId: row.sourceRecordId,
            trustTier: row.trustTier,
            recordedAt: row.recordedAt?.toISOString() ?? null,
            summary: wrapUntrustedText(row.summary, row.trustTier),
            structuredData:
              row.structuredDataJson !== null && row.structuredDataJson !== undefined
                ? wrapUntrustedText(
                    JSON.stringify(redactUnknown(row.structuredDataJson)),
                    row.trustTier,
                  )
                : null,
          })),
        };
        return {
          status: 'SUCCEEDED',
          errorCode: null,
          safeArguments: { evidenceIds: ids },
          evidenceIds,
          summary: `Loaded ${rows.length} evidence record(s)`,
          serializedContent: capJsonString(payload, input.maxToolResultChars),
        };
      }

      case 'search_related_events': {
        const incident = await input.repo.getIncident(input.workspaceId, input.incidentId);
        const windowMinutes = clampInt(input.rawArguments['windowMinutes'], 1, 180, 30);
        const limit = clampInt(input.rawArguments['limit'], 1, 20, 10);
        const integrationId =
          typeof input.rawArguments['integrationId'] === 'string' &&
          input.rawArguments['integrationId'].trim().length > 0
            ? input.rawArguments['integrationId'].trim()
            : incident?.integrationId;
        const traceId =
          typeof input.rawArguments['traceId'] === 'string' &&
          input.rawArguments['traceId'].trim().length > 0
            ? input.rawArguments['traceId'].trim()
            : undefined;

        const anchor = incident?.lastSeenAt ?? new Date();
        const from = new Date(anchor.getTime() - windowMinutes * 60_000);
        const to = new Date(anchor.getTime() + windowMinutes * 60_000);

        const related = await input.repo.searchRelatedEvents(input.workspaceId, {
          integrationId,
          traceId,
          from,
          to,
          limit,
        });
        const payload = {
          events: related.map((ev) => ({
            id: ev.id,
            integrationId: ev.integrationId,
            externalEventId: ev.externalEventId,
            eventType: ev.eventType,
            firstReceivedAt: ev.firstReceivedAt.toISOString(),
            traceId: ev.traceId,
            processingState: ev.processingState,
          })),
        };
        return {
          status: 'SUCCEEDED',
          errorCode: null,
          safeArguments: { integrationId, traceId, windowMinutes, limit },
          evidenceIds: [],
          summary: `Found ${related.length} related event(s) in ±${windowMinutes}m window`,
          serializedContent: capJsonString(payload, input.maxToolResultChars),
        };
      }

      case 'get_integration_config_summary': {
        const incident = await input.repo.getIncident(input.workspaceId, input.incidentId);
        const integrationId =
          typeof input.rawArguments['integrationId'] === 'string' &&
          input.rawArguments['integrationId'].trim().length > 0
            ? input.rawArguments['integrationId'].trim()
            : incident?.integrationId;
        if (!integrationId) {
          return notFoundOutcome(safeArguments, 'No integrationId resolved for incident');
        }
        const summary: IntegrationConfigSummaryView | null =
          await input.repo.getIntegrationConfigSummary(input.workspaceId, integrationId);
        if (!summary) {
          return notFoundOutcome(safeArguments, 'Integration not found in workspace');
        }
        return {
          status: 'SUCCEEDED',
          errorCode: null,
          safeArguments: { integrationId },
          evidenceIds: [],
          summary: `Loaded non-secret config summary for ${summary.endpoint} (${summary.environment})`,
          serializedContent: capJsonString(summary, input.maxToolResultChars),
        };
      }

      case 'get_rule_findings': {
        const findings = await input.repo.listRuleFindings(input.workspaceId, input.incidentId);
        const citedIds = [...new Set(findings.flatMap((f) => f.evidenceIds))];
        const payload = {
          findings: findings.map((f) => ({
            id: f.id,
            eventId: f.eventId,
            ruleId: f.ruleId,
            ruleVersion: f.ruleVersion,
            failureClass: f.failureClass,
            certainty: f.certainty,
            explanation: f.explanation,
            evidenceIds: f.evidenceIds,
          })),
        };
        return {
          status: 'SUCCEEDED',
          errorCode: null,
          safeArguments,
          evidenceIds: citedIds,
          summary: `Loaded ${findings.length} deterministic finding(s) citing ${citedIds.length} evidence ID(s)`,
          serializedContent: capJsonString(payload, input.maxToolResultChars),
        };
      }

      default:
        return {
          status: 'REJECTED',
          errorCode: 'UNKNOWN_TOOL',
          safeArguments,
          evidenceIds: [],
          summary: `Rejected unsupported tool "${input.toolName}"`,
          serializedContent: JSON.stringify({ error: 'unknown_tool' }),
        };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Tool execution error';
    return {
      status: 'FAILED',
      errorCode: 'TOOL_ERROR',
      safeArguments,
      evidenceIds: [],
      summary: `Tool ${input.toolName} failed safely`,
      serializedContent: JSON.stringify({ error: 'tool_failed', message: message.slice(0, 200) }),
    };
  }
}

function notFoundOutcome(safeArguments: Record<string, unknown>, message: string): ToolExecutionOutcome {
  return {
    status: 'SUCCEEDED',
    errorCode: null,
    safeArguments,
    evidenceIds: [],
    summary: message,
    serializedContent: JSON.stringify({ found: false, message }),
  };
}

function invalidArgsOutcome(safeArguments: Record<string, unknown>, message: string): ToolExecutionOutcome {
  return {
    status: 'FAILED',
    errorCode: 'INVALID_ARGUMENTS',
    safeArguments,
    evidenceIds: [],
    summary: message,
    serializedContent: JSON.stringify({ error: 'invalid_arguments', message }),
  };
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}
