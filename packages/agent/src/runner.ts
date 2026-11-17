import type { TokenUsage } from '#domain';
import { verifyAndNormalizeOutput } from './guardrails.ts';
import { AGENT_PROMPT_VERSION, buildSystemPrompt } from './prompt.ts';
import { ALLOWLISTED_TOOLS, executeAllowlistedTool } from './tools.ts';
import {
  DEFAULT_AGENT_BUDGETS,
  type AgentBudgets,
  type AgentRunResult,
  type AgentToolCallLog,
  type AgentToolRepository,
  type ChatMessage,
  type ModelProvider,
} from './types.ts';

export interface RunInvestigationAgentInput {
  readonly workspaceId: string;
  readonly incidentId: string;
  readonly provider: ModelProvider;
  readonly repo: AgentToolRepository;
  readonly budgets?: Partial<AgentBudgets>;
  readonly triggerReason?: string;
}

export async function runInvestigationAgent(
  input: RunInvestigationAgentInput,
): Promise<AgentRunResult> {
  const budgets: AgentBudgets = {
    ...DEFAULT_AGENT_BUDGETS,
    ...input.budgets,
  };

  const controller = new AbortController();
  const timeoutTimer = setTimeout(() => {
    controller.abort();
  }, budgets.maxDurationMs);
  timeoutTimer.unref?.();

  const observedEvidenceIds = new Set<string>();
  const toolLogs: AgentToolCallLog[] = [];
  const totalUsage: { promptTokens: number; completionTokens: number; totalTokens: number } = {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
  };
  let resolvedModelId = input.provider.model;

  const messages: ChatMessage[] = [
    { role: 'system', content: buildSystemPrompt() },
    {
      role: 'user',
      content: [
        `Investigate incident "${input.incidentId}" in workspace "${input.workspaceId}".`,
        input.triggerReason ? `Trigger reason: ${input.triggerReason}.` : '',
        'Start by calling get_incident, get_rule_findings, and list_event_attempts, then inspect relevant evidence IDs via get_evidence.',
      ]
        .filter(Boolean)
        .join('\n'),
    },
  ];

  let repairAttempted = false;

  try {
    // Allow at most maxToolCalls tool steps + up to 2 final synthesis/repair turns
    const maxModelTurns = budgets.maxToolCalls + 3;

    for (let turn = 0; turn < maxModelTurns; turn += 1) {
      if (controller.signal.aborted) {
        return {
          state: 'NEEDS_REVIEW',
          modelId: resolvedModelId,
          promptVersion: AGENT_PROMPT_VERSION,
          tokenUsage: totalUsage,
          toolCalls: toolLogs,
          output: null,
          errorCode: 'TIMEOUT',
          errorMessage: `Agent run exceeded ${budgets.maxDurationMs}ms deadline`,
        };
      }

      if (approximateChars(messages) > budgets.maxInputChars) {
        return {
          state: 'NEEDS_REVIEW',
          modelId: resolvedModelId,
          promptVersion: AGENT_PROMPT_VERSION,
          tokenUsage: totalUsage,
          toolCalls: toolLogs,
          output: null,
          errorCode: 'INPUT_BUDGET_EXCEEDED',
          errorMessage: 'Conversation context exceeded maxInputChars budget',
        };
      }

      const response = await input.provider.completeWithTools({
        messages,
        tools: ALLOWLISTED_TOOLS,
        signal: controller.signal,
      });

      if (response.modelId) resolvedModelId = response.modelId;
      accumulateUsage(totalUsage, response.usage);

      if (response.toolCalls.length > 0) {
        messages.push({
          role: 'assistant',
          content: response.content,
          toolCalls: response.toolCalls,
        });

        for (const tc of response.toolCalls) {
          if (toolLogs.length >= budgets.maxToolCalls) {
            const budgetMsg = JSON.stringify({
              error: 'tool_budget_exhausted',
              message: `Maximum tool call budget (${budgets.maxToolCalls}) reached. Produce the final JSON diagnosis now from observed evidence.`,
            });
            messages.push({
              role: 'tool',
              toolCallId: tc.id,
              toolName: tc.name,
              content: budgetMsg,
            });
            continue;
          }

          const startedAt = new Date();
          const outcome = await executeAllowlistedTool({
            toolName: tc.name,
            rawArguments: tc.arguments,
            workspaceId: input.workspaceId,
            incidentId: input.incidentId,
            repo: input.repo,
            maxToolResultChars: budgets.maxToolResultChars,
          });
          const endedAt = new Date();

          for (const evId of outcome.evidenceIds) {
            observedEvidenceIds.add(evId);
          }

          toolLogs.push({
            stepIndex: toolLogs.length + 1,
            toolName: tc.name,
            safeArgumentsJson: outcome.safeArguments,
            resultEvidenceIds: outcome.evidenceIds,
            resultSummary: outcome.summary,
            status: outcome.status,
            errorCode: outcome.errorCode,
            startedAt,
            endedAt,
          });

          messages.push({
            role: 'tool',
            toolCallId: tc.id,
            toolName: tc.name,
            content: outcome.serializedContent,
          });
        }

        if (toolLogs.length >= budgets.maxToolCalls) {
          messages.push({
            role: 'user',
            content:
              'Tool call budget is exhausted. Do not request any more tools. Output your final JSON diagnosis now.',
          });
        }
        continue;
      }

      // Final textual response -> validate & ground
      const rawText = response.content ?? '';
      const verified = verifyAndNormalizeOutput(
        rawText,
        observedEvidenceIds,
        budgets.maxHypotheses,
      );

      if (!verified.ok) {
        if (!repairAttempted) {
          repairAttempted = true;
          messages.push({ role: 'assistant', content: rawText });
          messages.push({
            role: 'user',
            content: `Your response did not satisfy the required JSON contract (${verified.reason}). Reply ONLY with the valid JSON object.`,
          });
          continue;
        }
        return {
          state: 'FAILED',
          modelId: resolvedModelId,
          promptVersion: AGENT_PROMPT_VERSION,
          tokenUsage: totalUsage,
          toolCalls: toolLogs,
          output: null,
          errorCode: 'INVALID_OUTPUT',
          errorMessage: verified.reason,
        };
      }

      const hasUnverified = verified.value.hypotheses.some(
        (h) => h.epistemicStatus === 'UNVERIFIED',
      );
      return {
        state: hasUnverified || verified.downgradedCount > 0 ? 'NEEDS_REVIEW' : 'COMPLETED',
        modelId: resolvedModelId,
        promptVersion: AGENT_PROMPT_VERSION,
        tokenUsage: totalUsage,
        toolCalls: toolLogs,
        output: verified.value,
        errorCode: null,
        errorMessage: null,
      };
    }

    return {
      state: 'NEEDS_REVIEW',
      modelId: resolvedModelId,
      promptVersion: AGENT_PROMPT_VERSION,
      tokenUsage: totalUsage,
      toolCalls: toolLogs,
      output: null,
      errorCode: 'BUDGET_EXHAUSTED',
      errorMessage: 'Agent reached maximum model turn count without producing a final diagnosis',
    };
  } catch (err) {
    const isAbort =
      controller.signal.aborted || (err instanceof Error && err.name === 'AbortError');
    return {
      state: isAbort ? 'NEEDS_REVIEW' : 'FAILED',
      modelId: resolvedModelId,
      promptVersion: AGENT_PROMPT_VERSION,
      tokenUsage: totalUsage,
      toolCalls: toolLogs,
      output: null,
      errorCode: isAbort ? 'TIMEOUT' : 'PROVIDER_ERROR',
      errorMessage: err instanceof Error ? err.message.slice(0, 300) : 'Unknown provider error',
    };
  } finally {
    clearTimeout(timeoutTimer);
  }
}

function accumulateUsage(
  target: { promptTokens: number; completionTokens: number; totalTokens: number },
  usage?: TokenUsage,
): void {
  if (!usage) return;
  if (typeof usage.promptTokens === 'number') target.promptTokens += usage.promptTokens;
  if (typeof usage.completionTokens === 'number') {
    target.completionTokens += usage.completionTokens;
  }
  if (typeof usage.totalTokens === 'number') {
    target.totalTokens += usage.totalTokens;
  } else {
    target.totalTokens = target.promptTokens + target.completionTokens;
  }
}

function approximateChars(messages: readonly ChatMessage[]): number {
  let total = 0;
  for (const m of messages) {
    total += (m.content ?? '').length;
    if (m.role === 'assistant' && m.toolCalls) {
      total += JSON.stringify(m.toolCalls).length;
    }
  }
  return total;
}
