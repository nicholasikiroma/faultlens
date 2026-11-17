import { randomUUID } from "node:crypto";
import { attachCostEstimate } from "#agent";
import { db } from "#db";
import type {
  HypothesisFeedbackRating,
  HypothesisRecord,
  InvestigationRunRecord,
  InvestigationSummary,
  RemediationProposal,
  TokenUsage,
  ToolCallRecord,
} from "#domain";
import { enqueueInvestigationRun } from "../../../worker/src/investigation-queue.ts";
import { recordAudit } from "../audit/audit.ts";
import { config } from "../config.ts";
import { verifyAdminToken } from "../read/auth.ts";

export interface TriggerInvestigationInput {
  workspaceId: string;
  incidentId: string;
  actor: string;
  reason?: string;
  enqueueFn?: (runId: string) => Promise<void>;
}

export type TriggerInvestigationResult =
  | { outcome: "ai-disabled" }
  | { outcome: "missing" }
  | { outcome: "already-running"; runId: string }
  | { outcome: "queue-unavailable"; runId: string }
  | { outcome: "queued"; runId: string; state: "QUEUED" };

export interface ListInvestigationsInput {
  adminToken: string | null | undefined;
  workspaceId: string;
  incidentId: string;
}

export type ListInvestigationsResult =
  | { kind: "unauthorized" }
  | { kind: "missing" }
  | {
      kind: "ok";
      incidentId: string;
      runs: readonly InvestigationRunRecord[];
      toolCalls: readonly ToolCallRecord[];
      hypotheses: readonly HypothesisRecord[];
      latestSummary: InvestigationSummary | null;
    };

export interface RateHypothesisInput {
  workspaceId: string;
  hypothesisId: string;
  actor: string;
  rating: HypothesisFeedbackRating;
}

export type RateHypothesisResult =
  | { outcome: "missing" }
  | { outcome: "unchanged"; hypothesis: HypothesisRecord }
  | {
      outcome: "rated";
      previousRating: HypothesisFeedbackRating;
      hypothesis: HypothesisRecord;
    };

export interface AgentSettingsInput {
  adminToken: string | null | undefined;
  workspaceId: string;
}

export type AgentSettingsResult =
  | { kind: "unauthorized" }
  | {
      kind: "ok";
      enabled: boolean;
      autoInvestigate: boolean;
      provider: string;
      model: string;
      baseUrlConfigured: boolean;
      budgets: {
        maxToolCalls: number;
        maxDurationMs: number;
      };
    };

export async function triggerInvestigation(
  input: TriggerInvestigationInput,
): Promise<TriggerInvestigationResult> {
  if (!config.aiEnabled) {
    return { outcome: "ai-disabled" };
  }

  const now = new Date();
  const created = await db.transaction(async (tx) => {
    const incident = await tx.orm.public.Incident.where({
      id: input.incidentId,
      workspaceId: input.workspaceId,
    })
      .forUpdate()
      .first();

    if (incident === null) {
      return { kind: "missing" as const };
    }

    const existingRuns = await tx.orm.public.InvestigationRun.where({
      workspaceId: input.workspaceId,
      incidentId: input.incidentId,
      mode: "AI_ASSISTED",
    }).all();

    const active = existingRuns.find(
      (run) => run.state === "QUEUED" || run.state === "RUNNING",
    );
    if (active) {
      return { kind: "already-running" as const, runId: active.id };
    }

    const runId = randomUUID();
    const reason = input.reason?.trim() || "manual_request";
    await tx.query(
      tx.raw.sql`
        INSERT INTO investigation_runs (
          id, workspace_id, incident_id, event_id, mode, state, triggered_by,
          trigger_reason, ruleset_version, started_at
        )
        VALUES (
          ${runId},
          ${input.workspaceId},
          ${input.incidentId},
          NULL,
          CAST(${"AI_ASSISTED"} AS "RunMode"),
          CAST(${"QUEUED"} AS "RunState"),
          ${input.actor},
          ${reason},
          ${"0"},
          CAST(${now.toISOString()} AS timestamptz)
        )
      `
        .affectedCount()
        .build(),
    );

    await recordAudit(
      tx,
      {
        action: "AI_INVESTIGATION_REQUESTED",
        workspaceId: input.workspaceId,
        actor: input.actor,
        objectId: runId,
        oldState: null,
        newState: "QUEUED",
      },
      now,
    );

    return { kind: "created" as const, runId };
  });

  if (created.kind === "missing") return { outcome: "missing" };
  if (created.kind === "already-running") {
    return { outcome: "already-running", runId: created.runId };
  }

  try {
    const enqueue = input.enqueueFn ?? enqueueInvestigationRun;
    await enqueue(created.runId);
    return { outcome: "queued", runId: created.runId, state: "QUEUED" };
  } catch {
    await db.orm.public.InvestigationRun.where({ id: created.runId }).update({
      state: "FAILED",
      errorCode: "QUEUE_UNAVAILABLE",
      errorMessage: "Failed to enqueue investigation job on Redis",
      endedAt: new Date(),
    });
    return { outcome: "queue-unavailable", runId: created.runId };
  }
}

export async function listIncidentInvestigations(
  input: ListInvestigationsInput,
): Promise<ListInvestigationsResult> {
  if (
    !verifyAdminToken(input.adminToken) ||
    input.workspaceId.trim().length === 0
  ) {
    return { kind: "unauthorized" };
  }

  const incident = await db.orm.public.Incident.where({
    id: input.incidentId,
    workspaceId: input.workspaceId,
  }).first();

  if (incident === null) {
    return { kind: "missing" };
  }

  const runRows = (
    await db.orm.public.InvestigationRun.where({
      workspaceId: input.workspaceId,
      incidentId: input.incidentId,
    }).all()
  ).sort(
    (a, b) =>
      b.startedAt.getTime() - a.startedAt.getTime() || a.id.localeCompare(b.id),
  );

  const runIds = new Set(runRows.map((r) => r.id));
  const toolCallRows = (
    await db.orm.public.ToolCall.where({
      workspaceId: input.workspaceId,
    }).all()
  )
    .filter((tc) => runIds.has(tc.investigationRunId))
    .sort((a, b) => a.stepIndex - b.stepIndex || a.startedAt.getTime() - b.startedAt.getTime());

  const hypothesisRows = (
    await db.orm.public.Hypothesis.where({
      workspaceId: input.workspaceId,
      incidentId: input.incidentId,
    }).all()
  ).sort(
    (a, b) =>
      b.createdAt.getTime() - a.createdAt.getTime() || a.id.localeCompare(b.id),
  );

  const runs: InvestigationRunRecord[] = runRows.map(toInvestigationRunRecord);
  const toolCalls: ToolCallRecord[] = toolCallRows.map(toToolCallRecord);
  const hypotheses: HypothesisRecord[] = hypothesisRows.map(toHypothesisRecord);

  const latestSummary =
    runs.find((r) => r.mode === "AI_ASSISTED" && r.summary !== null)?.summary ??
    null;

  return {
    kind: "ok",
    incidentId: input.incidentId,
    runs,
    toolCalls,
    hypotheses,
    latestSummary,
  };
}

export async function rateHypothesis(
  input: RateHypothesisInput,
): Promise<RateHypothesisResult> {
  return db.transaction(async (tx) => {
    const existing = await tx.orm.public.Hypothesis.where({
      id: input.hypothesisId,
      workspaceId: input.workspaceId,
    })
      .forUpdate()
      .first();

    if (existing === null) {
      return { outcome: "missing" };
    }

    if (existing.feedback === input.rating) {
      return { outcome: "unchanged", hypothesis: toHypothesisRecord(existing) };
    }

    await tx.orm.public.Hypothesis.where({ id: existing.id }).update({
      feedback: input.rating,
    });

    await recordAudit(tx, {
      action: "HYPOTHESIS_RATED",
      workspaceId: input.workspaceId,
      actor: input.actor,
      objectId: existing.id,
      oldState: existing.feedback,
      newState: input.rating,
    });

    return {
      outcome: "rated",
      previousRating: existing.feedback,
      hypothesis: toHypothesisRecord({ ...existing, feedback: input.rating }),
    };
  });
}

export async function getAgentSettings(
  input: AgentSettingsInput,
): Promise<AgentSettingsResult> {
  if (
    !verifyAdminToken(input.adminToken) ||
    input.workspaceId.trim().length === 0
  ) {
    return { kind: "unauthorized" };
  }

  return {
    kind: "ok",
    enabled: config.aiEnabled,
    autoInvestigate: config.aiAutoInvestigate,
    provider: config.aiProvider,
    model: config.aiModel,
    baseUrlConfigured: config.aiBaseUrlConfigured,
    budgets: {
      maxToolCalls: config.aiMaxToolCalls,
      maxDurationMs: config.aiTimeoutMs,
    },
  };
}

export function toInvestigationRunRecord(row: {
  id: string;
  workspaceId: string;
  incidentId: string;
  eventId: string | null;
  mode: InvestigationRunRecord["mode"];
  state: InvestigationRunRecord["state"];
  triggeredBy: string;
  triggerReason: string | null;
  modelId: string | null;
  promptVersion: string | null;
  rulesetVersion: string;
  tokenUsage: unknown;
  toolCallCount: number;
  errorCode: string | null;
  errorMessage: string | null;
  summaryJson: unknown;
  startedAt: Date;
  endedAt: Date | null;
}): InvestigationRunRecord {
  const rawUsage = (row.tokenUsage as TokenUsage | null) ?? null;
  const enrichedUsage =
    rawUsage === null
      ? null
      : attachCostEstimate({
          usage: rawUsage,
          modelId: row.modelId,
          providerId: config.aiProvider,
          baseUrl:
            config.aiProvider === "openai-compatible" && config.aiBaseUrlConfigured
              ? config.aiBaseUrl
              : undefined,
          inputCostPer1M: config.aiInputCostPer1M,
          outputCostPer1M: config.aiOutputCostPer1M,
        });

  return {
    id: row.id,
    workspaceId: row.workspaceId,
    incidentId: row.incidentId,
    eventId: row.eventId,
    mode: row.mode,
    state: row.state,
    triggeredBy: row.triggeredBy,
    triggerReason: row.triggerReason,
    modelId: row.modelId,
    promptVersion: row.promptVersion,
    rulesetVersion: row.rulesetVersion,
    tokenUsage: enrichedUsage,
    toolCallCount: row.toolCallCount,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    summary: (row.summaryJson as InvestigationSummary | null) ?? null,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
  };
}

export function toToolCallRecord(row: {
  id: string;
  investigationRunId: string;
  workspaceId: string;
  stepIndex: number;
  toolName: string;
  safeArgumentsJson: unknown;
  resultEvidenceIds: readonly (string | null)[] | null;
  resultSummary: string;
  status: ToolCallRecord["status"];
  errorCode: string | null;
  startedAt: Date;
  endedAt: Date;
}): ToolCallRecord {
  return {
    id: row.id,
    investigationRunId: row.investigationRunId,
    workspaceId: row.workspaceId,
    stepIndex: row.stepIndex,
    toolName: row.toolName,
    safeArgumentsJson: row.safeArgumentsJson,
    resultEvidenceIds: (row.resultEvidenceIds ?? []).filter(
      (id): id is string => id !== null,
    ),
    resultSummary: row.resultSummary,
    status: row.status,
    errorCode: row.errorCode,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
  };
}

export function toHypothesisRecord(row: {
  id: string;
  workspaceId: string;
  incidentId: string;
  investigationRunId: string;
  title: string;
  reasoning: string;
  epistemicStatus: HypothesisRecord["epistemicStatus"];
  confidence: HypothesisRecord["confidence"];
  citedEvidenceIds: readonly (string | null)[] | null;
  missingInformation: readonly (string | null)[] | null;
  suggestedCheck: string;
  remediationJson: unknown;
  feedback: HypothesisRecord["feedback"];
  createdAt: Date;
}): HypothesisRecord {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    incidentId: row.incidentId,
    investigationRunId: row.investigationRunId,
    title: row.title,
    reasoning: row.reasoning,
    epistemicStatus: row.epistemicStatus,
    confidence: row.confidence,
    citedEvidenceIds: (row.citedEvidenceIds ?? []).filter(
      (id): id is string => id !== null,
    ),
    missingInformation: (row.missingInformation ?? []).filter(
      (item): item is string => item !== null,
    ),
    suggestedCheck: row.suggestedCheck,
    remediation: (row.remediationJson as RemediationProposal | null) ?? null,
    feedback: row.feedback,
    createdAt: row.createdAt,
  };
}
