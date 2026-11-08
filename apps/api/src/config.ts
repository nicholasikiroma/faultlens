import "dotenv/config";

export const config = {
  get adminToken(): string {
    return process.env["WIRESLEUTH_ADMIN_TOKEN"] ?? "";
  },
  get workspaceId(): string {
    return process.env["WIRESLEUTH_WORKSPACE_ID"] ?? "workspace-1";
  },
  get adminActor(): string {
    return process.env["WIRESLEUTH_ADMIN_ACTOR"] ?? "local-admin";
  },
  get httpHost(): string {
    return process.env["WIRESLEUTH_API_HOST"] ?? "127.0.0.1";
  },
  get httpPort(): number {
    const raw = process.env["WIRESLEUTH_API_PORT"] ?? "3000";
    if (!/^\d+$/.test(raw)) {
      throw new Error("Invalid WIRESLEUTH_API_PORT");
    }
    const port = Number(raw);
    if (!Number.isInteger(port) || port > 65535) {
      throw new Error("Invalid WIRESLEUTH_API_PORT");
    }
    return port;
  },
  get simulatedWebhooks(): boolean {
    return process.env["WIRESLEUTH_SIMULATED_WEBHOOKS"] === "1";
  },
} as const;
