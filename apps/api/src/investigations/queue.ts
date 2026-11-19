import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { INVESTIGATIONS_QUEUE_NAME } from "#agent";
import { config } from "../config.ts";

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
    defaultConnection.on("error", () => {});
    defaultQueue = new Queue<InvestigationJobData>(INVESTIGATIONS_QUEUE_NAME, {
      connection: defaultConnection,
    });
    defaultQueue.on("error", () => {});
  }
  return defaultQueue;
}

export async function enqueueInvestigationRun(
  runId: string,
  redisUrl = config.redisUrl,
): Promise<void> {
  const queue = getInvestigationQueue(redisUrl);
  await queue.add("investigate", { runId }, { jobId: runId });
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
