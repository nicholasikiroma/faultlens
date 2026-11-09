import 'dotenv/config';

export const config = {
  get redisUrl(): string {
    return process.env['REDIS_URL'] ?? 'redis://127.0.0.1:6379';
  },
  get databaseUrl(): string {
    return process.env['DATABASE_URL'] ?? 'postgresql://lab:lab@localhost:5432/wiresleuth';
  },
  get dispatchIntervalMs(): number {
    const raw = process.env['WIRESLEUTH_DISPATCH_INTERVAL_MS'] ?? '1000';
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed < 50) {
      throw new Error('Invalid WIRESLEUTH_DISPATCH_INTERVAL_MS');
    }
    return parsed;
  },
} as const;
