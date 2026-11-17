import 'dotenv/config';

export type AiProviderKind = 'openai-compatible' | 'anthropic' | 'mock';

export const config = {
  get redisUrl(): string {
    return process.env['REDIS_URL'] ?? 'redis://127.0.0.1:6379';
  },
  get databaseUrl(): string {
    return process.env['DATABASE_URL'] ?? 'postgresql://lab:lab@localhost:5432/faultlens';
  },
  get dispatchIntervalMs(): number {
    const raw = process.env['FAULTLENS_DISPATCH_INTERVAL_MS'] ?? '1000';
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed < 50) {
      throw new Error('Invalid FAULTLENS_DISPATCH_INTERVAL_MS');
    }
    return parsed;
  },
  get aiEnabled(): boolean {
    return process.env['FAULTLENS_AI_ENABLED'] === '1';
  },
  get aiAutoInvestigate(): boolean {
    return process.env['FAULTLENS_AI_AUTO_INVESTIGATE'] !== '0';
  },
  get aiProvider(): AiProviderKind {
    const raw = process.env['FAULTLENS_AI_PROVIDER'] ?? 'openai-compatible';
    if (raw === 'openai-compatible' || raw === 'anthropic' || raw === 'mock') {
      return raw;
    }
    return 'openai-compatible';
  },
  get aiBaseUrl(): string {
    return process.env['FAULTLENS_AI_BASE_URL'] ?? 'http://127.0.0.1:11434/v1';
  },
  get aiModel(): string {
    return process.env['FAULTLENS_AI_MODEL'] ?? 'qwen2.5:14b-instruct';
  },
  get aiApiKey(): string | undefined {
    const key = process.env['FAULTLENS_AI_API_KEY'];
    return key && key.trim().length > 0 ? key.trim() : undefined;
  },
  get aiMaxToolCalls(): number {
    const raw = process.env['FAULTLENS_AI_MAX_TOOL_CALLS'] ?? '8';
    const parsed = Number(raw);
    return Number.isInteger(parsed) && parsed >= 1 && parsed <= 20 ? parsed : 8;
  },
  get aiTimeoutMs(): number {
    const raw = process.env['FAULTLENS_AI_TIMEOUT_MS'] ?? '60000';
    const parsed = Number(raw);
    return Number.isInteger(parsed) && parsed >= 1000 && parsed <= 300_000 ? parsed : 60_000;
  },
} as const;
