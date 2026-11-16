import "dotenv/config";
import { createFaultLensClient } from "#sdk";
import { createCommerceServer } from "./server.ts";
import { startTrafficGenerator } from "./traffic-generator.ts";

const port = Number(process.env["COMMERCE_SERVICE_PORT"] ?? "3002");
const apiUrl = process.env["FAULTLENS_API_URL"] ?? "http://127.0.0.1:3000";
const ingestKey = process.env["FAULTLENS_INGEST_KEY"] ?? "flk_seed_orders_local_ingest_key_00000002";
const signingSecret = process.env["FAULTLENS_SIGNING_SECRET"] ?? "seed-signing-secret-orders";

console.log("\x1b[1m\x1b[36m=======================================================\x1b[0m");
console.log("\x1b[1m\x1b[32m FaultLens Commerce Service (SDK FlightRecorder Demo) \x1b[0m");
console.log("\x1b[1m\x1b[36m=======================================================\x1b[0m");
console.log(`• Listening on:       http://127.0.0.1:${port}`);
console.log(`• FaultLens API:      ${apiUrl}`);
console.log(`• Ingest Key:         ${ingestKey.slice(0, 16)}...`);
console.log(`• Traffic Cadence:    Every ${process.env["COMMERCE_TRAFFIC_INTERVAL_MS"] ?? "3000"}ms`);
console.log(`• Failure Mix:        2 Healthy Events, then 1 Live Failure (Timeout, 429, Invalid Sig, Duplicate)`);
console.log("\x1b[2m-------------------------------------------------------\x1b[0m\n");

// 1. Initialize FlightRecorder SDK client
const faultlens = createFaultLensClient({
  baseUrl: apiUrl,
  apiKey: ingestKey,
  webhooks: {
    signingSecret,
  },
});

// 2. Start instrumented HTTP server
const server = createCommerceServer(faultlens, port);

server.listen(port, "127.0.0.1", () => {
  console.log(`Commerce webhook receiver ready at http://127.0.0.1:${port}/webhooks/orders`);
  console.log("Starting automated background traffic loop...\n");

  // 3. Start automated traffic generator
  const generator = startTrafficGenerator({
    targetUrl: `http://127.0.0.1:${port}`,
    signingSecret,
  });

  // Graceful shutdown
  const shutdown = () => {
    console.log("\nStopping Commerce service...");
    generator.stop();
    server.close(() => {
      console.log("Commerce server stopped cleanly.");
      process.exit(0);
    });
    setTimeout(() => server.closeAllConnections(), 1000).unref();
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
});

