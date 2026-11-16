import "dotenv/config";
import { createFaultLensClient } from "#sdk";
import { createSampleHost } from "./server.ts";

const faultlens = createFaultLensClient({
  baseUrl: process.env["FAULTLENS_API_URL"] ?? "http://127.0.0.1:3000",
  apiKey: process.env["FAULTLENS_INGEST_KEY"] ?? "",
  webhooks: {
    signingSecret: process.env["FAULTLENS_SIGNING_SECRET"] ?? "",
  },
});
const host = createSampleHost(faultlens);
host.listen(3001, "127.0.0.1", () => console.log("sample host listening on http://127.0.0.1:3001/webhook"));
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    host.close();
    const timer = setTimeout(() => host.closeAllConnections(), 1000);
    timer.unref();
    host.once("close", () => clearTimeout(timer));
  });
}
