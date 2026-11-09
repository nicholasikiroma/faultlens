import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { PostgresTransactionContext } from "@prisma/orm-postgres/runtime";
import { db, type Contract } from "#db";

type Tx = PostgresTransactionContext<Contract>;
type Scope = { workspaceId: string; integrationId: string };

export function hashIngestKey(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex");
}

async function insertKey(tx: Tx, integration: { id: string; workspaceId: string; environment: string }) {
  const key = `wsk_${randomBytes(32).toString("base64url")}`;
  const id = randomUUID();
  const createdAt = new Date();
  await tx.orm.public.IngestKey.create({
    id, integrationId: integration.id, workspaceId: integration.workspaceId,
    environment: integration.environment, keyHash: hashIngestKey(key), createdAt, revokedAt: null,
  });
  // Only creation/rotation return the raw credential. Never persist or log it.
  return { id, key, workspaceId: integration.workspaceId, integrationId: integration.id,
    environment: integration.environment, createdAt };
}

export async function createIngestKey(scope: Scope) {
  return db.transaction(async (tx) => {
    const integration = await tx.orm.public.Integration.where({
      id: scope.integrationId, workspaceId: scope.workspaceId,
    }).forUpdate().first();
    if (integration === null) return { outcome: "missing" } as const;
    return { outcome: "created", ...await insertKey(tx, integration) } as const;
  });
}

export async function revokeIngestKey(input: { workspaceId: string; keyId: string }) {
  return db.transaction(async (tx) => {
    const key = await tx.orm.public.IngestKey.where({ id: input.keyId, workspaceId: input.workspaceId }).forUpdate().first();
    if (key === null) return { outcome: "missing" } as const;
    if (key.revokedAt !== null) return { outcome: "unchanged" } as const;
    await tx.orm.public.IngestKey.where({ id: key.id }).update({ revokedAt: new Date() });
    return { outcome: "revoked" } as const;
  });
}

export async function rotateIngestKey(input: { workspaceId: string; keyId: string }) {
  return db.transaction(async (tx) => {
    // Lock in the same order as ingest: key, then integration. Revocation waits
    // for deliveries already authorized by this key to commit before returning.
    const key = await tx.orm.public.IngestKey.where({ id: input.keyId, workspaceId: input.workspaceId }).forUpdate().first();
    if (key === null || key.revokedAt !== null) return { outcome: "missing" } as const;
    const integration = await tx.orm.public.Integration.where({
      id: key.integrationId, workspaceId: key.workspaceId, environment: key.environment,
    }).forUpdate().first();
    if (integration === null) return { outcome: "missing" } as const;
    await tx.orm.public.IngestKey.where({ id: key.id }).update({ revokedAt: new Date() });
    return { outcome: "rotated", ...await insertKey(tx, integration) } as const;
  });
}

export async function integrationForKey(tx: Tx, token: string) {
  if (token.length === 0) return null;
  const key = await tx.orm.public.IngestKey.where({ keyHash: hashIngestKey(token) }).forUpdate().first();
  if (key === null || key.revokedAt !== null) return null;
  return tx.orm.public.Integration.where({
    id: key.integrationId, workspaceId: key.workspaceId, environment: key.environment,
  }).forUpdate().first();
}
