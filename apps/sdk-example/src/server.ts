import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import {
  type FlightRecorder,
  type WebhookCapture,
  recordVerification,
  withFlightRecorderNodeHttp,
} from "#sdk";

export type SampleHostTarget = FlightRecorder | WebhookCapture;

/** A sample application's own webhook handler. Demonstrates zero-interference flight-recording. */
export function createSampleHost(target: SampleHostTarget) {
  const isFlightRecorder = typeof (target as FlightRecorder).beginNodeEpisode === "function";

  const coreHandler = (req: IncomingMessage, res: ServerResponse) => {
    if (req.method !== "POST" || (req.url !== "/webhook" && !req.url?.startsWith("/webhook?"))) {
      res.writeHead(404).end();
      return;
    }

    // Host signature verification reporting
    const sig = req.headers["stripe-signature"] || req.headers["x-hub-signature-256"];
    if (sig) {
      recordVerification({ state: "VERIFIED", provider: "stripe" });
    }

    const chunks: Buffer[] = [];
    let bytes = 0;
    const hostBodyLimit = 1024 * 1024;

    req.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes <= hostBodyLimit) chunks.push(chunk);
      else chunks.length = 0;
    });

    req.on("error", () => {
      res.writeHead(400).end();
    });

    req.on("end", () => {
      if (bytes > hostBodyLimit) {
        res.writeHead(413).end();
        return;
      }
      const rawBody = Buffer.concat(chunks);

      res.writeHead(202, { "content-type": "application/json" });
      res.end(JSON.stringify({ accepted: true }));

      // If legacy capture interface is provided, invoke it
      if (!isFlightRecorder && "capture" in target) {
        void target.capture(rawBody);
      }
    });
  };

  if (isFlightRecorder) {
    const recorder = target as FlightRecorder;
    return createServer(
      withFlightRecorderNodeHttp(recorder, coreHandler, { routeTemplate: "/webhook" })
    );
  }

  return createServer(coreHandler);
}
