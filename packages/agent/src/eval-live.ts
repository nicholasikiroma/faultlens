import 'dotenv/config';
import { buildScenarioRepository, GOLDEN_SCENARIOS } from './eval-scenarios.ts';
import {
  AnthropicProvider,
  attachCostEstimate,
  OpenAICompatibleProvider,
  runInvestigationAgent,
  type ModelProvider,
} from './index.ts';

function buildLiveProvider(): { provider: ModelProvider; baseUrl?: string } {
  const kind = process.env['FAULTLENS_AI_PROVIDER'] ?? 'openai-compatible';
  const model = process.env['FAULTLENS_AI_MODEL'] ?? 'qwen2.5:14b-instruct';
  const apiKey = process.env['FAULTLENS_AI_API_KEY'];
  const baseUrl = process.env['FAULTLENS_AI_BASE_URL'] ?? 'http://127.0.0.1:11434/v1';

  if (kind === 'anthropic') {
    if (!apiKey) {
      throw new Error('FAULTLENS_AI_API_KEY is required when FAULTLENS_AI_PROVIDER=anthropic');
    }
    return { provider: new AnthropicProvider({ model, apiKey }) };
  }

  return {
    provider: new OpenAICompatibleProvider({ baseUrl, model, apiKey }),
    baseUrl,
  };
}

async function main(): Promise<void> {
  if (process.env['FAULTLENS_AI_ENABLED'] !== '1') {
    console.error(
      'FAULTLENS_AI_ENABLED is not 1. Set FAULTLENS_AI_ENABLED=1, FAULTLENS_AI_PROVIDER, FAULTLENS_AI_MODEL (and FAULTLENS_AI_BASE_URL / FAULTLENS_AI_API_KEY) to run live evaluations.',
    );
    process.exitCode = 1;
    return;
  }

  const { provider, baseUrl } = buildLiveProvider();
  const inputCost = process.env['FAULTLENS_AI_INPUT_COST_PER_1M']
    ? Number(process.env['FAULTLENS_AI_INPUT_COST_PER_1M'])
    : undefined;
  const outputCost = process.env['FAULTLENS_AI_OUTPUT_COST_PER_1M']
    ? Number(process.env['FAULTLENS_AI_OUTPUT_COST_PER_1M'])
    : undefined;

  const rows: Array<{
    scenario: string;
    state: string;
    grounded: boolean;
    abstainedOnUnknown: boolean;
    rejectedTools: number;
    toolCalls: number;
    tokens: number;
    costUsd: number | null;
    durationMs: number;
  }> = [];

  for (const scenario of GOLDEN_SCENARIOS) {
    const { incident, repo } = buildScenarioRepository(scenario);
    const t0 = Date.now();
    const res = await runInvestigationAgent({
      workspaceId: 'workspace-1',
      incidentId: incident.id,
      provider,
      repo,
    });
    const durationMs = Date.now() - t0;

    const usage = attachCostEstimate({
      usage: res.tokenUsage,
      modelId: res.modelId,
      providerId: provider.id,
      baseUrl,
      inputCostPer1M: inputCost,
      outputCostPer1M: outputCost,
    });

    const first = res.output?.hypotheses[0];
    const hasEvidence = scenario.evidence.length > 0;
    const grounded = hasEvidence
      ? Boolean(first && first.citedEvidenceIds.length > 0)
      : true;
    const abstainedOnUnknown =
      scenario.expectedEpistemic === 'UNVERIFIED'
        ? Boolean(first && (first.epistemicStatus === 'UNVERIFIED' || first.epistemicStatus === 'HYPOTHESIS'))
        : true;
    const rejectedTools = res.toolCalls.filter((t) => t.status === 'REJECTED').length;

    rows.push({
      scenario: scenario.name,
      state: res.state,
      grounded,
      abstainedOnUnknown,
      rejectedTools,
      toolCalls: res.toolCalls.length,
      tokens: usage?.totalTokens ?? 0,
      costUsd: usage?.estimatedCostUsd ?? null,
      durationMs,
    });
  }

  console.log(
    JSON.stringify(
      {
        provider: provider.id,
        model: provider.model,
        summary: {
          scenarios: rows.length,
          passedGrounding: rows.filter((r) => r.grounded).length,
          passedAbstention: rows.filter((r) => r.abstainedOnUnknown).length,
          totalRejectedTools: rows.reduce((s, r) => s + r.rejectedTools, 0),
          totalTokens: rows.reduce((s, r) => s + r.tokens, 0),
          totalCostUsd: rows.reduce((s, r) => s + (r.costUsd ?? 0), 0),
        },
        results: rows,
      },
      null,
      2,
    ),
  );
}

void main();
