import type { CostSource, TokenUsage } from '#domain';

export interface ModelRate {
  readonly inputPer1M: number;
  readonly outputPer1M: number;
}

/**
 * Reference USD rates per 1M tokens for common hosted models.
 * Operators can override via FAULTLENS_AI_INPUT_COST_PER_1M / FAULTLENS_AI_OUTPUT_COST_PER_1M.
 */
const REFERENCE_MODEL_RATES: readonly {
  readonly match: string;
  readonly rate: ModelRate;
}[] = [
  { match: 'gpt-4.1-nano', rate: { inputPer1M: 0.1, outputPer1M: 0.4 } },
  { match: 'gpt-4.1-mini', rate: { inputPer1M: 0.4, outputPer1M: 1.6 } },
  { match: 'gpt-4.1', rate: { inputPer1M: 2.0, outputPer1M: 8.0 } },
  { match: 'gpt-4o-mini', rate: { inputPer1M: 0.15, outputPer1M: 0.6 } },
  { match: 'gpt-4o', rate: { inputPer1M: 2.5, outputPer1M: 10.0 } },
  { match: 'o4-mini', rate: { inputPer1M: 1.1, outputPer1M: 4.4 } },
  { match: 'o3-mini', rate: { inputPer1M: 1.1, outputPer1M: 4.4 } },
  { match: 'claude-3-5-haiku', rate: { inputPer1M: 0.8, outputPer1M: 4.0 } },
  { match: 'claude-haiku-4', rate: { inputPer1M: 0.8, outputPer1M: 4.0 } },
  { match: 'claude-3-5-sonnet', rate: { inputPer1M: 3.0, outputPer1M: 15.0 } },
  { match: 'claude-3-7-sonnet', rate: { inputPer1M: 3.0, outputPer1M: 15.0 } },
  { match: 'claude-sonnet-4', rate: { inputPer1M: 3.0, outputPer1M: 15.0 } },
  { match: 'claude-opus-4', rate: { inputPer1M: 15.0, outputPer1M: 75.0 } },
  { match: 'gemini-2.5-flash', rate: { inputPer1M: 0.15, outputPer1M: 0.6 } },
  { match: 'gemini-2.5-pro', rate: { inputPer1M: 1.25, outputPer1M: 10.0 } },
  { match: 'gemini-2.0-flash', rate: { inputPer1M: 0.1, outputPer1M: 0.4 } },
];

export function lookupModelRate(modelId: string | null | undefined): ModelRate | null {
  if (!modelId) return null;
  const normalized = modelId.toLowerCase();
  for (const entry of REFERENCE_MODEL_RATES) {
    if (normalized.includes(entry.match)) {
      return entry.rate;
    }
  }
  return null;
}

export function isLocalEndpointUrl(baseUrl: string | null | undefined): boolean {
  if (!baseUrl) return false;
  try {
    const host = new URL(baseUrl).hostname.toLowerCase();
    return (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '::1' ||
      host === '0.0.0.0' ||
      host === 'ollama' ||
      host === 'vllm'
    );
  } catch {
    return false;
  }
}

export function attachCostEstimate(input: {
  readonly usage: TokenUsage | null | undefined;
  readonly modelId: string | null | undefined;
  readonly providerId?: string | null;
  readonly baseUrl?: string | null;
  readonly inputCostPer1M?: number | null;
  readonly outputCostPer1M?: number | null;
}): TokenUsage | null {
  const usage = input.usage;
  if (!usage) return null;

  if (typeof usage.estimatedCostUsd === 'number' && Number.isFinite(usage.estimatedCostUsd)) {
    return {
      ...usage,
      costSource: usage.costSource ?? 'provider',
    };
  }

  const promptTokens = usage.promptTokens ?? 0;
  const completionTokens = usage.completionTokens ?? 0;

  if (
    typeof input.inputCostPer1M === 'number' &&
    typeof input.outputCostPer1M === 'number' &&
    Number.isFinite(input.inputCostPer1M) &&
    Number.isFinite(input.outputCostPer1M)
  ) {
    const cost =
      (promptTokens / 1_000_000) * input.inputCostPer1M +
      (completionTokens / 1_000_000) * input.outputCostPer1M;
    return {
      ...usage,
      estimatedCostUsd: roundUsd(cost),
      costSource: 'env_rates',
    };
  }

  if (input.providerId === 'mock' || isLocalEndpointUrl(input.baseUrl)) {
    return {
      ...usage,
      estimatedCostUsd: 0,
      costSource: 'local_free',
    };
  }

  const ref = lookupModelRate(input.modelId);
  if (ref) {
    const cost =
      (promptTokens / 1_000_000) * ref.inputPer1M +
      (completionTokens / 1_000_000) * ref.outputPer1M;
    return {
      ...usage,
      estimatedCostUsd: roundUsd(cost),
      costSource: 'model_table',
    };
  }

  const source: CostSource = 'unknown';
  return {
    ...usage,
    estimatedCostUsd: null,
    costSource: source,
  };
}

function roundUsd(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
