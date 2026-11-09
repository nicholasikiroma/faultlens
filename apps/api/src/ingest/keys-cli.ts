import { db } from "#db";
import { config } from "../config.ts";
import { createIngestKey, revokeIngestKey, rotateIngestKey } from "./keys.ts";

// Operator-only command: requires direct database access, not an HTTP endpoint.
async function main(): Promise<void> {
  const [command, id, ...extra] = process.argv.slice(2);
  if (!id || extra.length > 0 || !["create", "rotate", "revoke"].includes(command ?? "")) {
    throw new Error("Usage: npm run ingest-key -- create <integrationId> | rotate <keyId> | revoke <keyId>");
  }
  const workspaceId = config.workspaceId;
  if (workspaceId.trim().length === 0) throw new Error("WIRESLEUTH_WORKSPACE_ID must not be blank");
  const result = command === "create"
    ? await createIngestKey({ workspaceId, integrationId: id })
    : command === "rotate"
      ? await rotateIngestKey({ workspaceId, keyId: id })
      : await revokeIngestKey({ workspaceId, keyId: id });
  if (result.outcome === "missing") process.exitCode = 1;
  // Deliberate one-time display to the operator. Protect stdout as a secret.
  console.log(JSON.stringify(result));
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : "Key operation failed");
  process.exitCode = 1;
} finally {
  await db.close();
}
