import { createServer } from "node:http";
import type { WebhookCapture } from "#sdk";

/** A sample application's own webhook handler. No WireSleuth server dependencies. */
export function createSampleHost(webhooks: WebhookCapture) {
  return createServer((req, res) => {
    if (req.method !== "POST" || req.url !== "/webhook") {
      res.writeHead(404).end();
      return;
    }
    const chunks: Buffer[] = [];
    let bytes = 0;
    // This is the host application's input limit, independent of the SDK's limit.
    const hostBodyLimit = 1024 * 1024;
    req.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes <= hostBodyLimit) chunks.push(chunk);
      else chunks.length = 0;
    });
    req.on("error", () => { res.writeHead(400).end(); });
    req.on("end", () => {
      if (bytes > hostBodyLimit) {
        res.writeHead(413).end();
        return;
      }
      const rawBody = Buffer.concat(chunks);
      // Perform provider verification and business processing here in a real host.
      // The telemetry SDK does not verify the incoming provider's signature.
      res.writeHead(202, { "content-type": "application/json" });
      res.end(JSON.stringify({ accepted: true }));
      // This promise always resolves. Do not await telemetry on the business path.
      void webhooks.capture(rawBody);
    });
  });
}
