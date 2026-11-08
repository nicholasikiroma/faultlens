import { Worker, type Job } from "bullmq";
import { Redis } from "ioredis";
import { classifyJob } from "./classify-job.ts";
import { config } from "./config.ts";
import { OUTBOX_QUEUE_NAME, type OutboxJobData } from "./queue.ts";

export async function handleOutboxJob(
  jobOrData: Job<OutboxJobData> | OutboxJobData,
): Promise<void> {
  const data = "data" in jobOrData ? jobOrData.data : jobOrData;
  if (data.eventId === null) {
    // A job with only an attempt id is a rejected delivery.
    // The handler finishes it and does not classify.
    return;
  }
  await classifyJob(data.eventId);
}

export interface OutboxWorkerOptions {
  connection?: Redis;
  redisUrl?: string;
  concurrency?: number;
}

export function createOutboxWorker(
  options?: OutboxWorkerOptions,
): Worker<OutboxJobData> {
  const ownsConnection = !options?.connection;
  const connection =
    options?.connection ??
    new Redis(options?.redisUrl ?? config.redisUrl, {
      maxRetriesPerRequest: null,
    });
  connection.on("error", () => {});

  const worker = new Worker<OutboxJobData>(
    OUTBOX_QUEUE_NAME,
    async (job: Job<OutboxJobData>) => {
      await handleOutboxJob(job);
    },
    {
      connection,
      concurrency: options?.concurrency ?? 1,
    },
  );
  worker.on("error", () => {});

  if (ownsConnection) {
    const originalClose = worker.close.bind(worker);
    worker.close = async () => {
      await originalClose();
      connection.disconnect();
    };
  }

  return worker;
}
