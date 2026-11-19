import { randomUUID } from 'node:crypto';
import {
  attachCostEstimate,
  createModelProvider,
  runInvestigationAgent,
  type AgentBudgets,
  type ModelProvider,
} from '#agent';
import { createPostgresAgentRepository } from '#agent-repo';
import { db } from '#db';
import { config } from './config.ts';

export interface InvestigateJobOptions {
  provider?: ModelProvider;
  budgets?: Partial<AgentBudgets>;
}

export function createProviderFromConfig(): ModelProvider {
  return createModelProvider({
    provider: config.aiProvider,
    model: config.aiModel,
    baseUrl: config.aiBaseUrl,
    apiKey: config.aiApiKey,
  });
}

export async function investigateJob(
  runId: string,
  options?: InvestigateJobOptions,
): Promise<void> {
  const claimed = await db.transaction(async (tx) => {
    const existing = await tx.orm.public.InvestigationRun.where({ id: runId })
      .forUpdate()
      .first();
    if (!existing) {
      return null;
    }
    if (existing.state !== 'QUEUED' && existing.state !== 'NOT_STARTED') {
      return { alreadyHandled: true as const, run: existing };
    }
    await tx.orm.public.InvestigationRun.where({ id: runId }).update({
      state: 'RUNNING',
      startedAt: new Date(),
    });
    return { alreadyHandled: false as const, run: existing };
  });

  if (!claimed) {
    throw new Error(`Missing investigation run ${runId}`);
  }
  if (claimed.alreadyHandled) {
    return;
  }

  const run = claimed.run;
  let provider: ModelProvider;
  try {
    provider = options?.provider ?? createProviderFromConfig();
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Invalid AI provider configuration';
    await db.orm.public.InvestigationRun.where({ id: runId }).update({
      state: 'FAILED',
      errorCode: 'PROVIDER_CONFIG_ERROR',
      errorMessage: msg.slice(0, 300),
      endedAt: new Date(),
    });
    return;
  }

  const repo = createPostgresAgentRepository();
  const result = await runInvestigationAgent({
    workspaceId: run.workspaceId,
    incidentId: run.incidentId,
    provider,
    repo,
    triggerReason: run.triggerReason ?? undefined,
    budgets: {
      maxToolCalls: config.aiMaxToolCalls,
      maxDurationMs: config.aiTimeoutMs,
      ...options?.budgets,
    },
  });

  const endedAt = new Date();

  await db.transaction(async (tx) => {
    type SafeArgsJson = Parameters<typeof tx.orm.public.ToolCall.create>[0]['safeArgumentsJson'];
    const toJson = (value: unknown): SafeArgsJson =>
      JSON.parse(JSON.stringify(value)) as SafeArgsJson;

    for (const tc of result.toolCalls) {
      await tx.orm.public.ToolCall.create({
        id: randomUUID(),
        investigationRunId: runId,
        workspaceId: run.workspaceId,
        stepIndex: tc.stepIndex,
        toolName: tc.toolName,
        safeArgumentsJson: toJson(tc.safeArgumentsJson),
        resultEvidenceIds: [...tc.resultEvidenceIds],
        resultSummary: tc.resultSummary,
        status: tc.status,
        errorCode: tc.errorCode,
        startedAt: tc.startedAt,
        endedAt: tc.endedAt,
      });
    }

    if (result.output) {
      for (const h of result.output.hypotheses) {
        await tx.orm.public.Hypothesis.create({
          id: randomUUID(),
          workspaceId: run.workspaceId,
          incidentId: run.incidentId,
          investigationRunId: runId,
          title: h.title,
          reasoning: h.reasoning,
          epistemicStatus: h.epistemicStatus,
          confidence: h.confidence,
          citedEvidenceIds: [...h.citedEvidenceIds],
          missingInformation: [...h.missingInformation],
          suggestedCheck: h.suggestedCheck,
          remediationJson: h.remediation ? toJson(h.remediation) : null,
          feedback: 'UNVERIFIED',
          createdAt: endedAt,
        });
      }
    }

    const summaryJson = result.output
      ? toJson({
          knownSummary: result.output.knownSummary,
          suspectSummary: result.output.suspectSummary,
          nextSafeCheckSummary: result.output.nextSafeCheckSummary,
        })
      : null;

    const tokenUsageWithCost = attachCostEstimate({
      usage: result.tokenUsage,
      modelId: result.modelId,
      providerId: provider.id,
      baseUrl: provider.id === 'openai-compatible' ? config.aiBaseUrl : undefined,
      inputCostPer1M: config.aiInputCostPer1M,
      outputCostPer1M: config.aiOutputCostPer1M,
    });

    await tx.orm.public.InvestigationRun.where({ id: runId }).update({
      state: result.state,
      modelId: result.modelId,
      promptVersion: result.promptVersion,
      tokenUsage: toJson(tokenUsageWithCost),
      toolCallCount: result.toolCalls.length,
      errorCode: result.errorCode,
      errorMessage: result.errorMessage,
      summaryJson,
      endedAt,
    });
  });
}
