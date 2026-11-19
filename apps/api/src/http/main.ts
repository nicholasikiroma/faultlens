import { db } from "#db";
import { closeInvestigationQueue } from "../investigations/queue.ts";
import { startApiServer } from "./server.ts";

const { url, close } = await startApiServer();
console.log(`faultlens api listening on ${url}`);

let shuttingDown = false;
async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    await close();
  } catch (error) {
    console.error("HTTP shutdown failed", error);
    process.exitCode = 1;
  } finally {
    try {
      await closeInvestigationQueue();
    } catch (error) {
      console.error("Queue shutdown failed", error);
      process.exitCode = 1;
    }
    try {
      await db.close();
    } catch (error) {
      console.error("Database shutdown failed", error);
      process.exitCode = 1;
    }
  }
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
