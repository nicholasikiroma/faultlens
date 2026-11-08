import type { HttpBindings } from "@hono/node-server";
import type { Context } from "hono";
import { config } from "../config.ts";
import { verifyAdminToken } from "../read/auth.ts";
import { JSON_BODY_LIMIT, MAX_EVENT_PAGE_SIZE, UNAUTHORIZED_BODY } from "./routes.ts";

export type ApiEnv = { Bindings: HttpBindings };
export type ApiContext = Context<ApiEnv>;

export interface AdminSession {
  readonly token: string;
  readonly workspaceId: string;
  readonly actor: string;
}

export type HeaderPairs = readonly (readonly [string, string])[];

export type Parsed<T> = { ok: true; value: T } | { ok: false; field: string };

type CommandBody =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; response: Response };

export function headerPairs(c: ApiContext): HeaderPairs {
  const raw = c.env?.incoming?.rawHeaders;
  if (raw !== undefined) {
    const pairs: Array<readonly [string, string]> = [];
    for (let index = 0; index < raw.length; index += 2) {
      const name = raw[index];
      const value = raw[index + 1];
      if (name === undefined || value === undefined) continue;
      pairs.push([name, value]);
    }
    return pairs;
  }
  return [...c.req.raw.headers];
}

export function flatHeaders(pairs: HeaderPairs): Readonly<Record<string, string>> {
  const headers: Record<string, string> = {};
  for (const [name, value] of pairs) {
    const key = name.toLowerCase();
    if (key === "authorization" || key === "cookie") continue;
    if (headers[key] === undefined) headers[key] = value;
  }
  return headers;
}

export function firstHeader(pairs: HeaderPairs, name: string): string | undefined {
  const wanted = name.toLowerCase();
  for (const [key, value] of pairs) {
    if (key.toLowerCase() === wanted) return value;
  }
  return undefined;
}

export function bearerToken(pairs: HeaderPairs): string | null {
  const raw = firstHeader(pairs, "authorization");
  if (raw === undefined) return null;
  const matched = /^Bearer (\S+)$/i.exec(raw);
  const token = matched?.[1];
  if (token === undefined || token.length === 0) return null;
  return token;
}

export function adminSession(pairs: HeaderPairs): AdminSession | null {
  const token = bearerToken(pairs);
  const workspaceId = config.workspaceId;
  if (token === null || !verifyAdminToken(token) || workspaceId.trim().length === 0) {
    return null;
  }
  return { token, workspaceId, actor: config.adminActor };
}

export function readCapped(request: Request, cap: number): Promise<Buffer> {
  const body = request.body;
  if (body === null) return Promise.resolve(Buffer.alloc(0));
  const reader = body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  const finish = (): Buffer => Buffer.concat(chunks, total);
  const pull = async (): Promise<Buffer> => {
    while (total < cap) {
      const { done, value } = await reader.read();
      if (done || value === undefined) break;
      const room = cap - total;
      if (value.byteLength > room) {
        chunks.push(Buffer.from(value.subarray(0, room)));
        total = cap;
        await reader.cancel();
        break;
      }
      chunks.push(Buffer.from(value));
      total += value.byteLength;
    }
    return finish();
  };
  return pull().finally(() => {
    reader.releaseLock();
  });
}

export async function readCommand(c: ApiContext, pairs: HeaderPairs): Promise<CommandBody> {
  if (!isJsonContentType(firstHeader(pairs, "content-type"))) {
    return { ok: false, response: c.json({ error: "unsupported_media_type" }, 415) };
  }
  const bytes = await readCapped(c.req.raw, JSON_BODY_LIMIT + 1);
  if (bytes.length > JSON_BODY_LIMIT) {
    return { ok: false, response: c.json({ error: "payload_too_large" }, 413) };
  }
  const parsed = parseJsonObject(bytes);
  if (!parsed.ok) return { ok: false, response: invalidRequest(c, parsed.field) };
  return { ok: true, value: parsed.value };
}

export function queryProblem(params: URLSearchParams, allowed: readonly string[]): string | null {
  const seen = new Set<string>();
  for (const key of params.keys()) {
    if (seen.has(key) || !allowed.some((item) => item === key)) return key;
    seen.add(key);
  }
  return null;
}

export function optionalText(params: URLSearchParams, key: string): Parsed<string | null> {
  if (!params.has(key)) return { ok: true, value: null };
  const raw = params.get(key);
  if (raw === null || raw.length === 0 || raw !== raw.trim()) return { ok: false, field: key };
  return { ok: true, value: raw };
}

export function optionalInstant(params: URLSearchParams, key: string): Parsed<Date | null> {
  if (!params.has(key)) return { ok: true, value: null };
  const raw = params.get(key);
  if (raw === null || raw.length === 0 || raw !== raw.trim() || Number.isNaN(Date.parse(raw))) {
    return { ok: false, field: key };
  }
  return { ok: true, value: new Date(raw) };
}

export function optionalMember<T extends string>(
  params: URLSearchParams,
  key: string,
  allowed: readonly T[],
): Parsed<T | null> {
  if (!params.has(key)) return { ok: true, value: null };
  const raw = params.get(key);
  if (raw === null) return { ok: false, field: key };
  const found = allowed.find((item) => item === raw);
  if (found === undefined) return { ok: false, field: key };
  return { ok: true, value: found };
}

export function parseLimit(params: URLSearchParams): Parsed<number | undefined> {
  if (!params.has("limit")) return { ok: true, value: undefined };
  const raw = params.get("limit");
  if (raw === null || !/^[1-9]\d*$/.test(raw)) return { ok: false, field: "limit" };
  const limit = Number(raw);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_EVENT_PAGE_SIZE) {
    return { ok: false, field: "limit" };
  }
  return { ok: true, value: limit };
}

export function requiredParam(params: Readonly<Record<string, string>>, name: string): string {
  const value = params[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`Missing path parameter ${name}`);
  }
  return value;
}

export function unauthorized(c: ApiContext, status: 401): Response {
  return c.json(UNAUTHORIZED_BODY, status, { "WWW-Authenticate": "Bearer" });
}

export function invalidRequest(c: ApiContext, field: string): Response {
  return c.json({ error: "invalid_request", field }, 400);
}

export function methodNotAllowed(c: ApiContext, allow: string): Response {
  return c.json({ error: "method_not_allowed" }, 405, { Allow: allow });
}

function parseJsonObject(bytes: Buffer): Parsed<Record<string, unknown>> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch {
    return { ok: false, field: "$" };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ok: false, field: "$" };
  }
  const value: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(parsed)) {
    value[key] = entry;
  }
  return { ok: true, value };
}

function isJsonContentType(value: string | undefined): boolean {
  if (value === undefined) return false;
  const media = value.split(";")[0]?.trim().toLowerCase();
  return media === "application/json";
}
