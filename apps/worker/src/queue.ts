import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { config } from './config.ts';

export const OUTBOX_QUEUE_NAME = 'outbox';

export interface OutboxJobData {
  eventId: string | null;
  attemptId: string;
}

let defaultQueue: Queue<OutboxJobData> | null = null;
let defaultConnection: Redis | null = null;

export function getQueue(redisUrl = config.redisUrl): Queue<OutboxJobData> {
  if (!defaultQueue) {
    defaultConnection = new Redis(redisUrl, {
      maxRetriesPerRequest: null,
      enableOfflineQueue: false,
    });
    defaultConnection.on('error', () => {
      // suppress unhandled error event
    });
    defaultQueue = new Queue<OutboxJobData>(OUTBOX_QUEUE_NAME, {
      connection: defaultConnection,
    });
    defaultQueue.on('error', () => {
      // suppress unhandled error event
    });
  }
  return defaultQueue;
}

export function createIsolatedQueue(redisUrl: string): {
  queue: Queue<OutboxJobData>;
  close: () => Promise<void>;
} {
  const connection = new Redis(redisUrl, {
    maxRetriesPerRequest: null,
    retryStrategy: () => null,
    enableOfflineQueue: false,
    lazyConnect: true,
  });
  connection.on('error', () => {
    // suppress unhandled error event
  });
  const queue = new Queue<OutboxJobData>(OUTBOX_QUEUE_NAME, {
    connection,
  });
  queue.on('error', () => {
    // suppress unhandled error event
  });
  return {
    queue,
    close: async () => {
      await queue.close();
      connection.disconnect();
    },
  };
}

export async function closeQueue(): Promise<void> {
  if (defaultQueue) {
    await defaultQueue.close();
    defaultQueue = null;
  }
  if (defaultConnection) {
    defaultConnection.disconnect();
    defaultConnection = null;
  }
}

