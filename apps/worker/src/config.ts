import 'dotenv/config';

export const config = {
  redisUrl: process.env['REDIS_URL'] ?? 'redis://127.0.0.1:6379',
  databaseUrl: process.env['DATABASE_URL'] ?? 'postgresql://lab:lab@localhost:5432/wiresleuth',
} as const;

