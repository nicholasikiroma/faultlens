import "dotenv/config";
import { createWireSleuthClient } from "#sdk";
import { createSampleHost } from "./server.ts";

const wiresleuth = createWireSleuthClient({
  baseUrl: process.env["WIRESLEUTH_API_URL"] ?? "http://127.0.0.1:3000",
  apiKey: process.env["WIRESLEUTH_INGEST_KEY"] ?? "",
  webhooks: {
    signingSecret: process.env["WIRESLEUTH_SIGNING_SECRET"] ?? "",
  },
});
const host = createSampleHost(wiresleuth.webhooks);
host.listen(3001, "127.0.0.1", () => console.log("sample host listening on http://127.0.0.1:3001/webhook"));
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    host.close();
    const timer = setTimeout(() => host.closeAllConnections(), 1000);
    timer.unref();
    host.once("close", () => clearTimeout(timer));
  });
}
