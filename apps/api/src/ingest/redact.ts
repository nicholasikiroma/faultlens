import { createHash } from "node:crypto";

const SECRET_KEY =
  /^(secret|authorization|signingkey|apikey|accesstoken|refreshtoken|password|passwd|privatekey|clientsecret|cookie|setcookie|xapikey)$|secret$/;

const SECRET_TEXT_REPLACEMENTS: readonly {
  readonly pattern: RegExp;
  readonly replacement: string;
}[] = [
  {
    pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
    replacement: "Bearer [REDACTED]",
  },
  {
    pattern: /\b(?:sk_live|sk_test|rk_live|rk_test|whsec|ghp|gho|glpat|xoxb|xoxp|flk)_[A-Za-z0-9_-]{8,}/g,
    replacement: "[REDACTED_SECRET]",
  },
  {
    pattern: /([?&](?:token|key|secret|api_key|apikey|access_token|password|sig)=)[^&\s]+/gi,
    replacement: "$1[REDACTED]",
  },
  {
    pattern: /(postgres(?:ql)?:\/\/[^:\s/]+:)[^@\s/]+(@)/gi,
    replacement: "$1[REDACTED]$2",
  },
];

export function redact(rawBody: Buffer): { digest: string; redacted: unknown } {
  const digest = createHash("sha256").update(rawBody).digest("hex");
  return { digest, redacted: redactedJson(rawBody) };
}

export function redactObject(value: unknown): unknown {
  return stripSecrets(value);
}

export function redactText(text: string): string {
  let clean = text;
  for (const { pattern, replacement } of SECRET_TEXT_REPLACEMENTS) {
    clean = clean.replace(pattern, replacement);
  }
  return clean;
}

function redactedJson(rawBody: Buffer): unknown {
  try {
    return stripSecrets(JSON.parse(rawBody.toString("utf8")) as unknown);
  } catch {
    return null;
  }
}

function stripSecrets(payload: unknown): unknown {
  if (typeof payload === "string") {
    return redactText(payload);
  }

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
