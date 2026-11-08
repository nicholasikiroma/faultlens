import type { Queue } from 'bullmq';
import { db } from '#db';
import {
  createIsolatedQueue,
  getQueue,
  type OutboxJobData,
} from './queue.ts';

export { OUTBOX_QUEUE_NAME, closeQueue, getQueue } from './queue.ts';
export type { OutboxJobData } from './queue.ts';

export interface DispatchOptions {
  queue?: Queue<OutboxJobData>;
  redisUrl?: string;
  now?: () => Date;
}

export async function dispatchPending(options?: DispatchOptions): Promise<number> {
  const pending = await db.orm.public.Outbox.where({ enqueuedAt: null }).all();
  if (pending.length === 0) {
    return 0;
  }

  let isolated: { queue: Queue<OutboxJobData>; close: () => Promise<void> } | null = null;
  let queue: Queue<OutboxJobData>;

  if (options?.queue) {
    queue = options.queue;
  } else if (options?.redisUrl) {
    isolated = createIsolatedQueue(options.redisUrl);
    queue = isolated.queue;
  } else {
    queue = getQueue();
  }

  const now = options?.now ?? (() => new Date());
  let marked = 0;

  try {
    for (const row of pending) {
      const jobId = row.eventId ?? row.attemptId;
      try {
        await queue.add(
          'outbox',
          {
            eventId: row.eventId,
            attemptId: row.attemptId,
          },
          {
            jobId,
          },
        );
      } catch {
        // If Redis is down, leave enqueuedAt null. The next call retries those rows.
        break;
      }

      await db.orm.public.Outbox.where({ id: row.id }).update({
        enqueuedAt: now(),
      });
      marked++;
    }
  } finally {
    if (isolated) {
      await isolated.close();
    }
  }

  return marked;
}
