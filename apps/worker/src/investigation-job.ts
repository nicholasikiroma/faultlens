import { randomUUID } from 'node:crypto';
import {
  AnthropicProvider,
  MockModelProvider,
  OpenAICompatibleProvider,
  runInvestigationAgent,
  type AgentBudgets,
  type ModelProvider,
} from '#agent';
import { db } from '#db';
import { createPostgresAgentRepository } from './agent-repo.ts';
import { config } from './config.ts';

export interface InvestigateJobOptions {
  provider?: ModelProvider;
  budgets?: Partial<AgentBudgets>;
}

export function createProviderFromConfig(): ModelProvider {
  switch (config.aiProvider) {
    case 'anthropic':
      if (!config.aiApiKey) {
        throw new Error('FAULTLENS_AI_API_KEY is required when FAULTLENS_AI_PROVIDER=anthropic');
      }
      return new AnthropicProvider({
        model: config.aiModel,
        apiKey: config.aiApiKey,
      });
    case 'mock':
      return new MockModelProvider([
        {
          content: JSON.stringify({
            knownSummary: 'Mock provider active; inspected incident records.',
            suspectSummary: 'Requires a live Ollama or cloud model for live inference.',
            nextSafeCheckSummary: 'Configure FAULTLENS_AI_PROVIDER=openai-compatible.',
            hypotheses: [
              {
                title: 'Mock investigation run completed',
                reasoning: 'Configured with FAULTLENS_AI_PROVIDER=mock.',
                epistemicStatus: 'UNVERIFIED',
                confidence: 'LOW',
                citedEvidenceIds: [],
                missingInformation: ['Live model endpoint'],
                suggestedCheck: 'Point FAULTLENS_AI_BASE_URL to Ollama or vLLM.',
              },
            ],
          }),
          toolCalls: [],
        },
      ]);
    case 'openai-compatible':
    default:
      return new OpenAICompatibleProvider({
        baseUrl: config.aiBaseUrl,
        model: config.aiModel,
        apiKey: config.aiApiKey,
      });
  }
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

    await tx.orm.public.InvestigationRun.where({ id: runId }).update({
      state: result.state,
      modelId: result.modelId,
      promptVersion: result.promptVersion,
      tokenUsage: toJson(result.tokenUsage),
      toolCallCount: result.toolCalls.length,
      errorCode: result.errorCode,
      errorMessage: result.errorMessage,
      summaryJson,
      endedAt,
    });
  });
}
