import "dotenv/config";

export const config = {
  get adminToken(): string {
    return process.env["FAULTLENS_ADMIN_TOKEN"] ?? "local-dev-admin-token";
  },
  get workspaceId(): string {
    return process.env["FAULTLENS_WORKSPACE_ID"] ?? "workspace-1";
  },
  get adminActor(): string {
    return process.env["FAULTLENS_ADMIN_ACTOR"] ?? "local-admin";
  },
  get httpHost(): string {
    return process.env["FAULTLENS_API_HOST"] ?? "127.0.0.1";
  },
  get httpPort(): number {
    const raw = process.env["FAULTLENS_API_PORT"] ?? "3000";
    if (!/^\d+$/.test(raw)) {
      throw new Error("Invalid FAULTLENS_API_PORT");
    }
    const port = Number(raw);
    if (!Number.isInteger(port) || port > 65535) {
      throw new Error("Invalid FAULTLENS_API_PORT");
    }
    return port;
  },
  get simulatedWebhooks(): boolean {
    return process.env["FAULTLENS_SIMULATED_WEBHOOKS"] === "1";
  },
  get corsOrigin(): string | undefined {
    return process.env["FAULTLENS_CORS_ORIGIN"];
  },
  get aiEnabled(): boolean {
    return process.env["FAULTLENS_AI_ENABLED"] === "1";
  },
  get aiAutoInvestigate(): boolean {
    return process.env["FAULTLENS_AI_AUTO_INVESTIGATE"] !== "0";
  },
  get aiProvider(): string {
    return process.env["FAULTLENS_AI_PROVIDER"] ?? "openai-compatible";
  },
  get aiModel(): string {
    return process.env["FAULTLENS_AI_MODEL"] ?? "qwen2.5:14b-instruct";
  },
  get aiBaseUrlConfigured(): boolean {
    const val = process.env["FAULTLENS_AI_BASE_URL"];
    return val !== undefined && val.trim().length > 0;
  },
  get aiMaxToolCalls(): number {
    const raw = process.env["FAULTLENS_AI_MAX_TOOL_CALLS"] ?? "8";
    const parsed = Number(raw);
    return Number.isInteger(parsed) && parsed >= 1 && parsed <= 20 ? parsed : 8;
  },
  get aiTimeoutMs(): number {
    const raw = process.env["FAULTLENS_AI_TIMEOUT_MS"] ?? "60000";
    const parsed = Number(raw);
    return Number.isInteger(parsed) && parsed >= 1000 && parsed <= 300_000 ? parsed : 60_000;
  },
} as const;
