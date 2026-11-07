import { createHash } from "node:crypto";

const SECRET_KEY = /^(secret|authorization|signingkey)$|secret$/;

export function redact(rawBody: Buffer): { digest: string; redacted: unknown } {
  const digest = createHash("sha256").update(rawBody).digest("hex");
  return { digest, redacted: redactedJson(rawBody) };
}

function redactedJson(rawBody: Buffer): unknown {
  try {
    return stripSecrets(JSON.parse(rawBody.toString("utf8")) as unknown);
  } catch {
    return null;
  }
}

function stripSecrets(payload: unknown): unknown {
  if (Array.isArray(payload)) {
    return payload.map((item) => stripSecrets(item));
  }

  if (payload === null || typeof payload !== "object") {
    return payload;
  }

  const clean: Record<string, unknown> = {};

  for (const [key, child] of Object.entries(payload)) {
    if (isSecretKey(key)) {
      continue;
    }
    clean[key] = stripSecrets(child);
  }
  return clean;
}

function isSecretKey(key: string): boolean {
  return SECRET_KEY.test(key.toLowerCase().replace(/[_-]/g, ""));
}
