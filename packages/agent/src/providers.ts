import type { TokenUsage } from '#domain';
import type {
  AgentToolDefinition,
  ChatMessage,
  ModelProvider,
  ModelToolCallRequest,
  ModelTurnResponse,
} from './types.ts';

export interface OpenAICompatibleOptions {
  readonly baseUrl: string;
  readonly model: string;
  readonly apiKey?: string;
}

export class OpenAICompatibleProvider implements ModelProvider {
  public readonly id = 'openai-compatible';
  public readonly model: string;
  private readonly baseUrl: string;
  private readonly apiKey?: string;

  constructor(options: OpenAICompatibleOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.model = options.model;
    this.apiKey = options.apiKey;
  }

  async completeWithTools(input: {
    readonly messages: readonly ChatMessage[];
    readonly tools: readonly AgentToolDefinition[];
    readonly signal?: AbortSignal;
  }): Promise<ModelTurnResponse> {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
    };
    if (this.apiKey && this.apiKey.trim().length > 0) {
      headers['authorization'] = `Bearer ${this.apiKey}`;
    }

    const body = {
      model: this.model,
      temperature: 0.1,
      messages: input.messages.map(toOpenAIMessage),
      tools: input.tools.map((tool) => ({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        },
      })),
      tool_choice: 'auto',
    };

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: input.signal,
    });

    if (!res.ok) {
      const errText = await safeReadText(res);
      throw new Error(`OpenAI-compatible provider returned HTTP ${res.status}: ${errText}`);
    }

    const data = (await res.json()) as Record<string, unknown>;
    const choices = Array.isArray(data['choices']) ? data['choices'] : [];
    const first = choices[0] as Record<string, unknown> | undefined;
    const message = (first?.['message'] ?? {}) as Record<string, unknown>;
    const content = typeof message['content'] === 'string' ? message['content'] : null;

    const rawToolCalls = Array.isArray(message['tool_calls']) ? message['tool_calls'] : [];
    const toolCalls: ModelToolCallRequest[] = [];
    for (const rawTc of rawToolCalls) {
      if (!rawTc || typeof rawTc !== 'object') continue;
      const tc = rawTc as Record<string, unknown>;
      const fn = (tc['function'] ?? {}) as Record<string, unknown>;
      const name = typeof fn['name'] === 'string' ? fn['name'] : '';
      const id = typeof tc['id'] === 'string' ? tc['id'] : `tc_${toolCalls.length}`;
      const args = parseJsonArgs(fn['arguments']);
      if (name) {
        toolCalls.push({ id, name, arguments: args });
      }
    }

    return {
      content,
      toolCalls,
      usage: parseOpenAIUsage(data['usage']),
      modelId: typeof data['model'] === 'string' ? data['model'] : this.model,
    };
  }
}

export interface AnthropicProviderOptions {
  readonly baseUrl?: string;
  readonly model: string;
  readonly apiKey: string;
}

export class AnthropicProvider implements ModelProvider {
  public readonly id = 'anthropic';
  public readonly model: string;
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(options: AnthropicProviderOptions) {
    this.baseUrl = (options.baseUrl ?? 'https://api.anthropic.com').replace(/\/+$/, '');
    this.model = options.model;
    this.apiKey = options.apiKey;
  }

  async completeWithTools(input: {
    readonly messages: readonly ChatMessage[];
    readonly tools: readonly AgentToolDefinition[];
    readonly signal?: AbortSignal;
  }): Promise<ModelTurnResponse> {
    const systemParts: string[] = [];
    const anthropicMessages: Array<{ role: 'user' | 'assistant'; content: unknown }> = [];

    for (const msg of input.messages) {
      if (msg.role === 'system') {
        systemParts.push(msg.content);
      } else if (msg.role === 'user') {
        anthropicMessages.push({ role: 'user', content: msg.content });
      } else if (msg.role === 'assistant') {
        const blocks: unknown[] = [];
        if (msg.content) blocks.push({ type: 'text', text: msg.content });
        for (const tc of msg.toolCalls ?? []) {
          blocks.push({
            type: 'tool_use',
            id: tc.id,
            name: tc.name,
            input: tc.arguments,
          });
        }
        anthropicMessages.push({ role: 'assistant', content: blocks });
      } else if (msg.role === 'tool') {
        anthropicMessages.push({
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: msg.toolCallId,
              content: msg.content,
            },
          ],
        });
      }
    }

    const res = await fetch(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 2048,
        system: systemParts.join('\n\n'),
        messages: anthropicMessages,
        tools: input.tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          input_schema: tool.parameters,
        })),
      }),
      signal: input.signal,
    });

    if (!res.ok) {
      const errText = await safeReadText(res);
      throw new Error(`Anthropic provider returned HTTP ${res.status}: ${errText}`);
    }

    const data = (await res.json()) as Record<string, unknown>;
    const blocks = Array.isArray(data['content']) ? data['content'] : [];
    const textParts: string[] = [];
    const toolCalls: ModelToolCallRequest[] = [];

    for (const block of blocks) {
      if (!block || typeof block !== 'object') continue;
      const b = block as Record<string, unknown>;
      if (b['type'] === 'text' && typeof b['text'] === 'string') {
        textParts.push(b['text']);
      } else if (b['type'] === 'tool_use' && typeof b['name'] === 'string') {
        toolCalls.push({
          id: typeof b['id'] === 'string' ? b['id'] : `tc_${toolCalls.length}`,
          name: b['name'],
          arguments:
            b['input'] && typeof b['input'] === 'object' && !Array.isArray(b['input'])
              ? (b['input'] as Record<string, unknown>)
              : {},
        });
      }
    }

    const usageObj = data['usage'] as Record<string, unknown> | undefined;
    const promptTokens =
      typeof usageObj?.['input_tokens'] === 'number' ? usageObj['input_tokens'] : undefined;
    const completionTokens =
      typeof usageObj?.['output_tokens'] === 'number' ? usageObj['output_tokens'] : undefined;

    return {
      content: textParts.length > 0 ? textParts.join('\n') : null,
      toolCalls,
      usage: {
        promptTokens,
        completionTokens,
        totalTokens:
          promptTokens !== undefined && completionTokens !== undefined
            ? promptTokens + completionTokens
            : undefined,
      },
      modelId: typeof data['model'] === 'string' ? data['model'] : this.model,
    };
  }
}

export class MockModelProvider implements ModelProvider {
  public readonly id = 'mock';
  public readonly model: string;
  private turnIndex = 0;

  constructor(
    private readonly script:
      | readonly ModelTurnResponse[]
      | ((messages: readonly ChatMessage[], turn: number) => ModelTurnResponse | Promise<ModelTurnResponse>),
    model = 'mock-investigator-v1',
  ) {
    this.model = model;
  }

  async completeWithTools(input: {
    readonly messages: readonly ChatMessage[];
    readonly tools: readonly AgentToolDefinition[];
    readonly signal?: AbortSignal;
  }): Promise<ModelTurnResponse> {
    if (input.signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }
    const idx = this.turnIndex++;
    if (typeof this.script === 'function') {
      return this.script(input.messages, idx);
    }
    const response = this.script[Math.min(idx, this.script.length - 1)];
    if (!response) {
      throw new Error('MockModelProvider has no scripted turns');
    }
    return response;
  }
}

function toOpenAIMessage(msg: ChatMessage): Record<string, unknown> {
  if (msg.role === 'assistant') {
    return {
      role: 'assistant',
      content: msg.content,
      ...(msg.toolCalls && msg.toolCalls.length > 0
        ? {
            tool_calls: msg.toolCalls.map((tc) => ({
              id: tc.id,
              type: 'function',
              function: {
                name: tc.name,
                arguments: JSON.stringify(tc.arguments),
              },
            })),
          }
        : {}),
    };
  }
  if (msg.role === 'tool') {
    return {
      role: 'tool',
      tool_call_id: msg.toolCallId,
      content: msg.content,
    };
  }
  return {
    role: msg.role,
    content: msg.content,
  };
}

function parseJsonArgs(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  if (typeof raw !== 'string') return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function parseOpenAIUsage(raw: unknown): TokenUsage | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const u = raw as Record<string, unknown>;
  return {
    promptTokens: typeof u['prompt_tokens'] === 'number' ? u['prompt_tokens'] : undefined,
    completionTokens:
      typeof u['completion_tokens'] === 'number' ? u['completion_tokens'] : undefined,
    totalTokens: typeof u['total_tokens'] === 'number' ? u['total_tokens'] : undefined,
  };
}

async function safeReadText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 300);
  } catch {
    return '';
  }
}
