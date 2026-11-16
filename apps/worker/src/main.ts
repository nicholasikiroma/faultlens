import { db } from '#db';
import { config } from './config.ts';
import { createOutboxWorker } from './consumer.ts';
import { closeQueue, dispatchPending } from './dispatcher.ts';

export interface WorkerRuntime {
  close: () => Promise<void>;
}

export async function startWorker(options?: {
  dispatchIntervalMs?: number;
}): Promise<WorkerRuntime> {
  const intervalMs = options?.dispatchIntervalMs ?? config.dispatchIntervalMs;
  const worker = createOutboxWorker();
  let stopped = false;
  let dispatching = false;

  const tick = async (): Promise<void> => {
    if (stopped || dispatching) return;
    dispatching = true;
    try {
      await dispatchPending();
    } catch (error) {
      console.error('Outbox dispatch tick failed', error);
    } finally {
      dispatching = false;
    }
  };

  await tick();
  const timer = setInterval(() => {
    void tick();
  }, intervalMs);
  timer.unref();

  return {
    close: async () => {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      await worker.close();
      await closeQueue();
    },
  };
}

const isEntrypoint =
  process.argv[1] !== undefined &&
  import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'));

if (isEntrypoint) {
  const runtime = await startWorker();
  console.log('faultlens worker started');

  let shuttingDown = false;
  const shutdown = async (): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    try {
      await runtime.close();
    } catch (error) {
      console.error('Worker shutdown failed', error);
      process.exitCode = 1;
    } finally {
      await db.close();
    }
  };

  process.on('SIGINT', () => {
    void shutdown();
  });
  process.on('SIGTERM', () => {
    void shutdown();
  });
}
