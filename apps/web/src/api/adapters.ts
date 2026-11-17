import type {
  AgentRunSummary,
  AgentTokenUsage,
  AiSynthesisSummary,
  FailureClass,
  HypothesisItem,
  Incident,
  IncidentSeverity,
  IncidentStatus,
  RemediationProposal,
  TimelineEvent,
  ToolCallSummary,
  EvidenceItem,
  AttemptItem,
  RuleFinding,
} from '../types';

export interface BackendIncidentSummary {
  id: string;
  workspaceId: string;
  integrationId: string;
  environment: string;
  endpoint: string;
  fingerprint: string;
  ruleVersion: string;
  failureClass: string;
  status: string;
  firstSeenAt: string | Date;
  lastSeenAt: string | Date;
  eventCount: number;
}

export interface BackendWebhookEvent {
  id: string;
  integrationId: string;
  externalEventId: string | null;
  eventType: string | null;
  occurredAt: string | Date | null;
  firstReceivedAt: string | Date;
  traceId: string | null;
  payloadDigest: string;
  redactedPayloadJson: unknown | null;
  processingState: string;
}

export interface BackendDeliveryAttempt {
  id: string;
  eventId: string | null;
  integrationId: string;
  receivedAt: string | Date;
  httpStatus: number | null;
  durationMs: number | null;
  senderWaitMs: number | null;
  verificationState: string;
  handlerState: string;
  errorCode: string | null;
  correlationId: string;
}

export interface BackendEvidence {
  id: string;
  sourceKind: string;
  sourceRecordId: string;
  summary: string;
  sha256Digest: string;
  trustTier: string;
  recordedAt?: string | Date | null;
  structuredDataJson?: unknown | null;
}

export interface BackendExportedFinding {
  id: string;
  eventId: string;
  ruleId: string;
  ruleVersion: string;
  failureClass: string;
  explanation: string;
  certainty: string;
  evidenceIds: readonly string[];
}

export interface BackendHypothesis {
  id: string;
  investigationRunId: string;
  title: string;
  reasoning: string;
  epistemicStatus: 'OBSERVED' | 'INFERRED' | 'HYPOTHESIS' | 'UNVERIFIED';
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  citedEvidenceIds: readonly string[];
  missingInformation: readonly string[];
  suggestedCheck: string;
  remediation: RemediationProposal | null;
  feedback: 'USEFUL' | 'INCORRECT' | 'UNVERIFIED';
  createdAt: string | Date;
}

export interface BackendInvestigationRun {
  id: string;
  mode: 'RULES' | 'AI_ASSISTED';
  state: 'NOT_STARTED' | 'QUEUED' | 'RUNNING' | 'NEEDS_REVIEW' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  triggeredBy: string;
  triggerReason: string | null;
  modelId: string | null;
  promptVersion: string | null;
  tokenUsage?: AgentTokenUsage | null;
  toolCallCount: number;
  errorCode: string | null;
  errorMessage: string | null;
  summary: {
    knownSummary: string;
    suspectSummary: string;
    nextSafeCheckSummary: string;
  } | null;
  startedAt: string | Date;
  endedAt: string | Date | null;
}

export interface BackendToolCall {
  id: string;
  investigationRunId: string;
  stepIndex: number;
  toolName: string;
  safeArgumentsJson: Record<string, unknown>;
  resultEvidenceIds: readonly string[];
  resultSummary: string;
  status: 'SUCCEEDED' | 'FAILED' | 'REJECTED';
  errorCode: string | null;
  startedAt: string | Date;
  endedAt: string | Date;
}

export interface BackendExportIncidentResult {
  kind: 'ok' | 'missing' | 'unauthorized';
  incidentId: string;
  incident: BackendIncidentSummary;
  timeline: readonly BackendWebhookEvent[];
  events: readonly BackendWebhookEvent[];
  attempts: readonly BackendDeliveryAttempt[];
  evidence: readonly BackendEvidence[];
  findings: readonly BackendExportedFinding[];
  hypotheses?: readonly BackendHypothesis[];
  agentRuns?: readonly BackendInvestigationRun[];
  toolCalls?: readonly BackendToolCall[];
}

function normalizeFailureClass(cls: string): FailureClass {
  const upper = cls.toUpperCase();
  if (upper === 'UPSTREAM_5XX' || upper === 'HTTP_5XX') return 'HTTP_5XX';
  if (upper === 'RATE_LIMIT') return 'RATE_LIMIT';
  if (upper === 'SCHEMA_MISMATCH') return 'SCHEMA_MISMATCH';
  if (upper === 'NETWORK_TIMEOUT') return 'NETWORK_TIMEOUT';
  if (upper === 'INVALID_SIGNATURE') return 'INVALID_SIGNATURE';
  if (upper === 'DUPLICATE_DELIVERY') return 'DUPLICATE_DELIVERY';
  if (upper === 'OUT_OF_ORDER') return 'OUT_OF_ORDER';
  if (upper === 'AUTH_FAILURE') return 'AUTH_FAILURE';
  if (upper === 'INGRESS_ABORTED') return 'INGRESS_ABORTED';
  if (upper === 'DECRYPT_FAILURE') return 'DECRYPT_FAILURE';
  if (upper === 'DOWNSTREAM_NETWORK_ERROR') return 'DOWNSTREAM_NETWORK_ERROR';
  if (upper === 'UNHANDLED_EXCEPTION') return 'UNHANDLED_EXCEPTION';
  if (upper === 'ASYNC_ESCAPE_FAILURE') return 'ASYNC_ESCAPE_FAILURE';
  if (upper === 'UNKNOWN') return 'UNKNOWN';
  return 'HTTP_5XX';
}

function normalizeStatus(status: string): IncidentStatus {
  const upper = status.toUpperCase();
  if (upper === 'INVESTIGATING') return 'INVESTIGATING';
  if (upper === 'RESOLVED') return 'RESOLVED';
  if (upper === 'ARCHIVED' || upper === 'IGNORED') return 'IGNORED';
  return 'OPEN';
}

function deriveSeverity(cls: FailureClass): IncidentSeverity {
  switch (cls) {
    case 'HTTP_5XX':
      return 'CRITICAL';
    case 'AUTH_FAILURE':
    case 'INVALID_SIGNATURE':
      return 'HIGH';
    case 'RATE_LIMIT':
    case 'SCHEMA_MISMATCH':
    case 'NETWORK_TIMEOUT':
      return 'MEDIUM';
    default:
      return 'LOW';
  }
}

function deriveTitle(cls: FailureClass, endpoint: string): string {
  const target = endpoint.replace(/^\/hooks\//, '').toUpperCase() || 'WEBHOOK';
  switch (cls) {
    case 'RATE_LIMIT':
      return `Upstream rate-limit responses on ${target}`;
    case 'SCHEMA_MISMATCH':
      return `Inbound payload validation failed on ${target}`;
    case 'NETWORK_TIMEOUT':
      return `Socket timeout during upstream dispatch on ${target}`;
    case 'INVALID_SIGNATURE':
      return `HMAC signature verification failed on ${target}`;
    case 'AUTH_FAILURE':
      return `Ingress credentials rejected (401) on ${target}`;
    case 'HTTP_5XX':
      return `Upstream service returned 5xx error on ${target}`;
    case 'DUPLICATE_DELIVERY':
      return `Duplicate delivery observed on ${target}`;
    case 'OUT_OF_ORDER':
      return `Out-of-order sequence detected on ${target}`;
    default:
      return `Integration anomaly observed on ${target}`;
  }
}

function deriveOperationalGuidance(cls: FailureClass): {
  known: string;
  suspect: string;
  next: string;
} {
  switch (cls) {
    case 'RATE_LIMIT':
      return {
        known: 'Upstream HTTP server responded with status 429 Too Many Requests.',
        suspect: 'Integration is exceeding allocated burst quota during scheduled background sync.',
        next: 'Inspect upstream Retry-After headers and configure jittered exponential backoff.',
      };
    case 'SCHEMA_MISMATCH':
      return {
        known: 'Payload schema validation rejected incoming payload due to missing or invalid fields.',
        suspect: 'Upstream provider deployed a new API revision with altered payload attributes.',
        next: 'Inspect Zod validation diff in evidence drawer and update event schema contract.',
      };
    case 'NETWORK_TIMEOUT':
      return {
        known: 'TCP/TLS connection to upstream endpoint timed out before headers arrived.',
        suspect: 'Upstream gateway or egress network proxy is experiencing connection saturation.',
        next: 'Verify upstream endpoint health, DNS resolution, and increase socket timeout threshold.',
      };
    case 'INVALID_SIGNATURE':
      return {
        known: 'Calculated HMAC-SHA256 signature did not match the x-faultlens-signature header.',
        suspect: 'Webhook signing secret mismatch or header was modified in transit.',
        next: 'Rotate integration signing secret and verify raw payload body bytes before parsing.',
      };
    case 'AUTH_FAILURE':
      return {
        known: 'Ingress delivery was rejected with HTTP 401 Unauthorized.',
        suspect: 'API key has expired, was revoked, or lacks required permission scopes.',
        next: 'Check API key expiration in integration settings and generate a replacement key.',
      };
    case 'HTTP_5XX':
      return {
        known: 'Upstream server returned an internal server error (500/502/503).',
        suspect: 'Upstream downstream database or application service crashed under load.',
        next: 'Check upstream service status page and verify error response body in attempts log.',
      };
    default:
      return {
        known: 'Telemetry observed repeated delivery anomalies on this integration channel.',
        suspect: 'Integration behavior deviates from baseline traffic profile.',
        next: 'Inspect delivery attempts and rule findings in the investigation console.',
      };
  }
}

export function formatRelativeTime(date: Date | string | number): string {
  const target = new Date(date);
  const now = Date.now();
  const diffMs = now - target.getTime();
  if (isNaN(diffMs) || diffMs < 0) return 'Just now';
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 15) return 'Just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}h ago`;
  const diffDays = Math.floor(diffHour / 24);
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  return target.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export function toFrontendIncidentSummary(summary: BackendIncidentSummary): Incident {
  const cls = normalizeFailureClass(summary.failureClass);
  const status = normalizeStatus(summary.status);
  const severity = deriveSeverity(cls);
  const title = deriveTitle(cls, summary.endpoint);
  const guidance = deriveOperationalGuidance(cls);
  const key = `INC-${summary.id.slice(0, 8).toUpperCase()}`;

  const firstDate = new Date(summary.firstSeenAt);
  const lastDate = new Date(summary.lastSeenAt);

  return {
    id: summary.id,
    key,
    title,
    integration: summary.endpoint.replace(/^\/hooks\//, '').toUpperCase() + ' Source',
    cls,
    events: summary.eventCount,
    severity,
    status,
    seen: formatRelativeTime(lastDate),
    firstSeen: firstDate.toUTCString().replace(/ GMT$/, ' UTC'),
    lastSeenTimestamp: lastDate.getTime(),
    known: guidance.known,
    suspect: guidance.suspect,
    next: guidance.next,
    timeline: [],
    evidence: [],
    attempts: [],
    ruleFindings: [],
    hypotheses: [
      {
        id: `hyp_${summary.id}`,
        title: `Automated Pipeline Classification: ${cls}`,
        reasoning: `Rule classifier matched 100% of telemetry criteria for ${cls} under rule ${summary.ruleVersion}.`,
        source: 'deterministic',
        confidence: 'HIGH',
        suggestedCheck: guidance.next,
        feedback: 'none',
      },
    ],
    aiSummary: null,
    rawPayload: {
      incidentId: summary.id,
      fingerprint: summary.fingerprint,
      endpoint: summary.endpoint,
      ruleVersion: summary.ruleVersion,
    },
  };
}

export function toFrontendIncidentDetail(exportData: BackendExportIncidentResult): Incident {
  const base = toFrontendIncidentSummary(exportData.incident);

  // 1. Evidence items
  const evidenceMap = new Map<string, EvidenceItem>();
  const evidenceList: EvidenceItem[] = exportData.evidence.map((ev) => {
    const item: EvidenceItem = {
      id: ev.id,
      title: `${ev.sourceKind}: ${ev.summary.split('.')[0] || 'Evidence Record'}`,
      description: ev.summary,
      source: ev.sourceKind,
      epistemic: ev.trustTier === 'A' ? 'OBSERVED' : 'RULE',
      data: {
        id: ev.id,
        sourceKind: ev.sourceKind,
        sourceRecordId: ev.sourceRecordId,
        sha256Digest: ev.sha256Digest,
        trustTier: ev.trustTier,
        ...(ev.structuredDataJson !== undefined && ev.structuredDataJson !== null
          ? { structuredData: ev.structuredDataJson }
          : {}),
      },
    };
    evidenceMap.set(ev.id, item);
    return item;
  });

  // 2. Attempts
  const attemptsList: AttemptItem[] = exportData.attempts.map((att, idx) => {
    const timeStr = new Date(att.receivedAt).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    const linkedEvId = exportData.evidence.find((e) => e.sourceRecordId === att.id)?.id || evidenceList[0]?.id || 'evd_none';
    return {
      id: att.id,
      attemptNumber: idx + 1,
      time: timeStr,
      status: att.httpStatus ?? 0,
      durationMs: att.durationMs ?? 0,
      evidenceId: linkedEvId,
    };
  });

  // 3. Timeline Events
  const timelineList: TimelineEvent[] = [];

  // Add event ingress checkpoint
  if (exportData.events.length > 0) {
    exportData.events.forEach((ev) => {
      const timeStr = new Date(ev.firstReceivedAt).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
      timelineList.push({
        id: `tl_ev_${ev.id}`,
        time: timeStr,
        title: `Webhook event received [${ev.eventType || 'inbound'}]`,
        description: `External event ID: ${ev.externalEventId || 'none'} • Trace: ${ev.traceId || 'none'} • Digest: ${ev.payloadDigest.slice(0, 16)}...`,
        severity: 'normal',
        evidenceId: evidenceList[0]?.id || 'evd_none',
      });
    });
  }

  // Add delivery attempts checkpoints
  exportData.attempts.forEach((att, idx) => {
    const timeStr = new Date(att.receivedAt).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    const isFail = (att.httpStatus && att.httpStatus >= 400) || att.verificationState === 'FAILED' || att.errorCode !== null;
    const isRetry = idx > 0;
    timelineList.push({
      id: `tl_att_${att.id}`,
      time: timeStr,
      title: isFail
        ? `Attempt 0${idx + 1} rejected with HTTP ${att.httpStatus || 'ERROR'}`
        : `Attempt 0${idx + 1} completed with HTTP ${att.httpStatus || 200}`,
      description: `Handler state: ${att.handlerState} • Verification: ${att.verificationState}${att.errorCode ? ` • Error: ${att.errorCode}` : ''}`,
      severity: isFail ? (isRetry ? 'danger' : 'warn') : 'normal',
      evidenceId: exportData.evidence.find((e) => e.sourceRecordId === att.id)?.id || evidenceList[0]?.id || 'evd_none',
    });
  });

  // Add rule match findings checkpoints
  exportData.findings.forEach((finding) => {
    timelineList.push({
      id: `tl_find_${finding.id}`,
      time: base.seen,
      title: `Deterministic classifier rule ${finding.ruleId} triggered`,
      description: finding.explanation,
      severity: 'warn',
      evidenceId: finding.evidenceIds[0] || evidenceList[0]?.id || 'evd_none',
    });
  });

  // Sort timeline chronologically
  timelineList.sort((a, b) => a.time.localeCompare(b.time));

  // 4. Rule findings
  const ruleFindingsList: RuleFinding[] = exportData.findings.map((f) => ({
    ruleId: f.ruleId,
    name: f.explanation.split('.')[0] || f.ruleId,
    description: f.explanation,
    matchedEvents: 1,
  }));

  const agentRuns: AgentRunSummary[] = (exportData.agentRuns ?? []).map((r) => ({
    id: r.id,
    mode: r.mode,
    state: r.state,
    triggeredBy: r.triggeredBy,
    triggerReason: r.triggerReason,
    modelId: r.modelId,
    promptVersion: r.promptVersion,
    tokenUsage: r.tokenUsage ?? null,
    toolCallCount: r.toolCallCount,
    errorCode: r.errorCode,
    errorMessage: r.errorMessage,
    startedAt: new Date(r.startedAt).toISOString(),
    endedAt: r.endedAt ? new Date(r.endedAt).toISOString() : null,
  }));

  const toolCalls: ToolCallSummary[] = (exportData.toolCalls ?? []).map((tc) => ({
    id: tc.id,
    investigationRunId: tc.investigationRunId,
    stepIndex: tc.stepIndex,
    toolName: tc.toolName,
    safeArgumentsJson: tc.safeArgumentsJson,
    resultEvidenceIds: [...tc.resultEvidenceIds],
    resultSummary: tc.resultSummary,
    status: tc.status,
    errorCode: tc.errorCode,
    startedAt: new Date(tc.startedAt).toISOString(),
    endedAt: new Date(tc.endedAt).toISOString(),
  }));

  const runById = new Map(agentRuns.map((r) => [r.id, r]));

  const persistedHypotheses: HypothesisItem[] = (exportData.hypotheses ?? []).map((h) => {
    const parentRun = runById.get(h.investigationRunId);
    return {
      id: h.id,
      title: h.title,
      reasoning: h.reasoning,
      source: 'ai',
      modelId: parentRun?.modelId ?? null,
      epistemicStatus: h.epistemicStatus,
      confidence: h.confidence,
      citedEvidenceIds: [...h.citedEvidenceIds],
      missingInformation: [...h.missingInformation],
      suggestedCheck: h.suggestedCheck,
      remediation: h.remediation,
      isPersisted: true,
      feedback:
        h.feedback === 'USEFUL'
          ? 'helpful'
          : h.feedback === 'INCORRECT'
          ? 'false_positive'
          : 'unverified',
    };
  });

  const latestAiRunWithSummary = exportData.agentRuns?.find((r) => r.summary !== null) ?? null;
  const aiSummary: AiSynthesisSummary | null =
    latestAiRunWithSummary && latestAiRunWithSummary.summary
      ? {
          known: latestAiRunWithSummary.summary.knownSummary,
          suspect: latestAiRunWithSummary.summary.suspectSummary,
          next: latestAiRunWithSummary.summary.nextSafeCheckSummary,
          modelId: latestAiRunWithSummary.modelId,
          promptVersion: latestAiRunWithSummary.promptVersion,
          runState: latestAiRunWithSummary.state,
          endedAt: latestAiRunWithSummary.endedAt
            ? new Date(latestAiRunWithSummary.endedAt).toISOString()
            : null,
        }
      : null;

  return {
    ...base,
    aiSummary,
    timeline: timelineList.length > 0 ? timelineList : base.timeline,
    evidence: evidenceList.length > 0 ? evidenceList : base.evidence,
    attempts: attemptsList.length > 0 ? attemptsList : base.attempts,
    ruleFindings: ruleFindingsList.length > 0 ? ruleFindingsList : base.ruleFindings,
    hypotheses: persistedHypotheses.length > 0 ? persistedHypotheses : base.hypotheses,
    agentRuns,
    toolCalls,
    rawPayload: {
      incidentId: exportData.incidentId,
      fingerprint: exportData.incident.fingerprint,
      endpoint: exportData.incident.endpoint,
      ruleVersion: exportData.incident.ruleVersion,
      findingsCount: exportData.findings.length,
      attemptsCount: exportData.attempts.length,
    },
  };
}
