import { Queue, Worker, type Job } from 'bullmq';
import { Redis } from 'ioredis';
import { INVESTIGATIONS_QUEUE_NAME } from '#agent';
import { config } from './config.ts';
import { investigateJob } from './investigation-job.ts';

export { INVESTIGATIONS_QUEUE_NAME };

export interface InvestigationJobData {
  runId: string;
}

let defaultQueue: Queue<InvestigationJobData> | null = null;
let defaultConnection: Redis | null = null;

export function getInvestigationQueue(
  redisUrl = config.redisUrl,
): Queue<InvestigationJobData> {
  if (!defaultQueue) {
    defaultConnection = new Redis(redisUrl, {
      maxRetriesPerRequest: null,
      enableOfflineQueue: false,
    });
    defaultConnection.on('error', () => {});
    defaultQueue = new Queue<InvestigationJobData>(INVESTIGATIONS_QUEUE_NAME, {
      connection: defaultConnection,
    });
    defaultQueue.on('error', () => {});
  }
  return defaultQueue;
}

export async function enqueueInvestigationRun(
  runId: string,
  redisUrl = config.redisUrl,
): Promise<void> {
  const queue = getInvestigationQueue(redisUrl);
  await queue.add('investigate', { runId }, { jobId: runId });
}

export async function closeInvestigationQueue(): Promise<void> {
  if (defaultQueue) {
    await defaultQueue.close();
    defaultQueue = null;
  }
  if (defaultConnection) {
    defaultConnection.disconnect();
    defaultConnection = null;
  }
}

export function createInvestigationWorker(options?: {
  connection?: Redis;
  redisUrl?: string;
  concurrency?: number;
}): Worker<InvestigationJobData> {
  const ownsConnection = !options?.connection;
  const connection =
    options?.connection ??
    new Redis(options?.redisUrl ?? config.redisUrl, {
      maxRetriesPerRequest: null,
    });
  connection.on('error', () => {});

  const worker = new Worker<InvestigationJobData>(
    INVESTIGATIONS_QUEUE_NAME,
    async (job: Job<InvestigationJobData>) => {
      await investigateJob(job.data.runId);
    },
    {
      connection,
      concurrency: options?.concurrency ?? 2,
    },
  );
  worker.on('error', () => {});

  if (ownsConnection) {
    const originalClose = worker.close.bind(worker);
    worker.close = async () => {
      await originalClose();
      connection.disconnect();
    };
  }

  return worker;
}
