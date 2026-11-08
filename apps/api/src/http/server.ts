import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import {
  AUDIT_OBJECT_TYPES,
  FAILURE_CLASSES,
  FEEDBACK_RATINGS,
  INCIDENT_STATUSES,
  PROCESSING_STATES,
  type FeedbackRating,
  type IncidentStatus,
} from "#domain";
import { listAuditEvents } from "../audit/audit.ts";
import { config } from "../config.ts";
import { listFindingFeedback, rateFinding } from "../feedback/feedback.ts";
import { transitionIncident } from "../incidents/lifecycle.ts";
import { ingest, MAX_BODY_BYTES } from "../ingest/ingest.ts";
import { verifyAdminToken } from "../read/auth.ts";
import { listAttempts, listEvents, type EventFilters } from "../read/events.ts";
import { exportIncident } from "../read/export.ts";
import { listIncidents } from "../read/incidents.ts";
import {
  ADMIN_QUERY_KEYS,
  EXPORT_INCIDENT_STATUS,
  INGEST_STATUS,
  JSON_BODY_LIMIT,
  LIST_ATTEMPTS_STATUS,
  LIST_AUDIT_STATUS,
  LIST_EVENTS_STATUS,
  LIST_FEEDBACK_STATUS,
  LIST_INCIDENTS_STATUS,
  MAX_EVENT_PAGE_SIZE,
  RATE_FINDING_STATUS,
  ROUTES,
  TRANSITION_STATUS,
  UNAUTHORIZED_BODY,
  type AdminRouteId,
  type Route,
} from "./routes.ts";

const RAW_READ_CAP = MAX_BODY_BYTES + 1;

interface AdminSession {
  readonly token: string;
  readonly workspaceId: string;
  readonly actor: string;
}

interface CompiledRoute {
  readonly route: Route;
  readonly match: (pathname: string) => Readonly<Record<string, string>> | null;
}

type AdminRoute = Extract<Route, { id: AdminRouteId }>;
type IngestRoute = Extract<Route, { id: "ingest" | "simulateWebhook" }>;

type Parsed<T> = { ok: true; value: T } | { ok: false; field: string };

export function createApiServer(): Server {
  const compiled = ROUTES.filter(isMounted).map(compile);
  return createServer((req, res) => {
    void handle(compiled, req, res).catch((error: unknown) => {
      console.error(error);
      if (!res.headersSent && !res.writableEnded) {
        writeJson(res, 500, { error: "internal" });
      }
    });
  });
}

export async function startApiServer(options?: {
  port?: number;
  host?: string;
}): Promise<{ server: Server; url: string; close: () => Promise<void> }> {
  const host = options?.host ?? config.httpHost;
  const port = options?.port ?? config.httpPort;
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error("Invalid WIRESLEUTH_API_PORT");
  }
  const server = createApiServer();
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("error", onError);
      reject(error);
    };
    server.on("error", onError);
    server.listen(port, host, () => {
      server.off("error", onError);
      resolve();
    });
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Expected a TCP address");
  }
  const url = `http://${formatHost(host)}:${address.port}`;
  return {
    server,
    url,
    close: () =>
      new Promise((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      }),
  };
}

function isMounted(route: Route): boolean {
  switch (route.access.kind) {
    case "admin":
      return true;
    case "ingest":
      return route.access.traffic === "real" || config.simulatedWebhooks;
    default: {
      const unreachable: never = route.access;
      return unreachable;
    }
  }
}

async function handle(
  compiled: readonly CompiledRoute[],
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const method = req.method ?? "";
  let url: URL;
  try {
    url = new URL(req.url ?? "/", "http://127.0.0.1");
  } catch {
    writeJson(res, 400, { error: "invalid_request", field: "url" });
    return;
  }

  const matches: Array<{ route: Route; params: Readonly<Record<string, string>> }> = [];
  for (const candidate of compiled) {
    const params = candidate.match(url.pathname);
    if (params !== null) matches.push({ route: candidate.route, params });
  }
  if (matches.length === 0) {
    writeJson(res, 404, { error: "not_found" });
    return;
  }

  const matched = matches.find((candidate) => candidate.route.method === method);
  if (matched === undefined) {
    const allow = [...new Set(matches.map((candidate) => candidate.route.method))].join(", ");
    writeJson(res, 405, { error: "method_not_allowed" }, { Allow: allow });
    return;
  }

  switch (matched.route.id) {
    case "ingest":
    case "simulateWebhook":
      await handleIngest(matched.route, matched.params, req, res);
      return;
    case "listEvents":
    case "listAttempts":
    case "listIncidents":
    case "exportIncident":
    case "transitionIncident":
    case "rateFinding":
    case "listFindingFeedback":
    case "listAuditEvents":
      await handleAdmin(matched.route, matched.params, url, req, res);
      return;
    default: {
      const unreachable: never = matched.route;
      throw new Error(`Unhandled route ${JSON.stringify(unreachable)}`);
    }
  }
}

async function handleIngest(
  route: IngestRoute,
  params: Readonly<Record<string, string>>,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const rawBody = await readCapped(req, RAW_READ_CAP);
  const result = await ingest({
    token: ingestCredential(route, params, req),
    rawBody,
    headers: flatHeaders(req),
  });
  switch (result.outcome) {
    case "stored":
    case "duplicate":
    case "conflict":
    case "rejected":
    case "schema-error":
    case "oversized":
    case "unknown-token":
      writeJson(res, INGEST_STATUS[result.outcome], result);
      return;
    default: {
      const unreachable: never = result;
      throw new Error(`Unhandled ingest result ${JSON.stringify(unreachable)}`);
    }
  }
}

function ingestCredential(
  route: IngestRoute,
  params: Readonly<Record<string, string>>,
  req: IncomingMessage,
): string {
  switch (route.access.credential) {
    case "bearer":
      return bearerToken(req) ?? "";
    case "path":
      return requiredParam(params, "token");
    default: {
      const unreachable: never = route.access;
      return unreachable;
    }
  }
}

async function handleAdmin(
  route: AdminRoute,
  params: Readonly<Record<string, string>>,
  url: URL,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const session = adminSession(req);
  if (session === null) {
    writeJson(res, 401, UNAUTHORIZED_BODY, { "WWW-Authenticate": "Bearer" });
    return;
  }
  const queryField = queryProblem(url.searchParams, ADMIN_QUERY_KEYS[route.id]);
  if (queryField !== null) {
    writeJson(res, 400, { error: "invalid_request", field: queryField });
    return;
  }

  switch (route.id) {
    case "listEvents": {
      const parsed = parseEventQuery(url.searchParams);
      if (!parsed.ok) {
        writeJson(res, 400, { error: "invalid_request", field: parsed.field });
        return;
      }
      const result = await listEvents({
        adminToken: session.token,
        workspaceId: session.workspaceId,
        cursor: parsed.value.cursor,
        limit: parsed.value.limit,
        filters: parsed.value.filters,
      });
      switch (result.kind) {
        case "unauthorized":
          writeUnauthorized(res, LIST_EVENTS_STATUS.unauthorized);
          return;
        case "ok":
          writeJson(res, LIST_EVENTS_STATUS.ok, result);
          return;
        default: {
          const unreachable: never = result;
          throw new Error(`Unhandled listEvents result ${JSON.stringify(unreachable)}`);
        }
      }
    }
    case "listAttempts": {
      const result = await listAttempts({
        adminToken: session.token,
        workspaceId: session.workspaceId,
        eventId: requiredParam(params, "eventId"),
      });
      switch (result.kind) {
        case "unauthorized":
          writeUnauthorized(res, LIST_ATTEMPTS_STATUS.unauthorized);
          return;
        case "ok":
          writeJson(res, LIST_ATTEMPTS_STATUS.ok, result);
          return;
        default: {
          const unreachable: never = result;
          throw new Error(`Unhandled listAttempts result ${JSON.stringify(unreachable)}`);
        }
      }
    }
    case "listIncidents": {
      const failureClass = optionalMember(url.searchParams, "failureClass", FAILURE_CLASSES);
      if (!failureClass.ok) {
        writeJson(res, 400, { error: "invalid_request", field: failureClass.field });
        return;
      }
      const result = await listIncidents({
        adminToken: session.token,
        workspaceId: session.workspaceId,
        failureClass: failureClass.value,
      });
      switch (result.kind) {
        case "unauthorized":
          writeUnauthorized(res, LIST_INCIDENTS_STATUS.unauthorized);
          return;
        case "ok":
          writeJson(res, LIST_INCIDENTS_STATUS.ok, result);
          return;
        default: {
          const unreachable: never = result;
          throw new Error(`Unhandled listIncidents result ${JSON.stringify(unreachable)}`);
        }
      }
    }
    case "exportIncident": {
      const result = await exportIncident({
        adminToken: session.token,
        workspaceId: session.workspaceId,
        incidentId: requiredParam(params, "incidentId"),
      });
      switch (result.kind) {
        case "unauthorized":
          writeUnauthorized(res, EXPORT_INCIDENT_STATUS.unauthorized);
          return;
        case "missing":
          writeJson(res, EXPORT_INCIDENT_STATUS.missing, result);
          return;
        case "ok":
          writeJson(res, EXPORT_INCIDENT_STATUS.ok, result);
          return;
        default: {
          const unreachable: never = result;
          throw new Error(`Unhandled exportIncident result ${JSON.stringify(unreachable)}`);
        }
      }
    }
    case "transitionIncident": {
      const body = await readCommand(req, res);
      if (body === undefined) return;
      const parsed = parseStatusBody(body);
      if (!parsed.ok) {
        writeJson(res, 400, { error: "invalid_request", field: parsed.field });
        return;
      }
      const result = await transitionIncident({
        workspaceId: session.workspaceId,
        incidentId: requiredParam(params, "incidentId"),
        status: parsed.value,
        actor: session.actor,
      });
      switch (result.outcome) {
        case "transitioned":
        case "unchanged":
        case "illegal":
        case "missing":
          writeJson(res, TRANSITION_STATUS[result.outcome], result);
          return;
        default: {
          const unreachable: never = result;
          throw new Error(`Unhandled transition result ${JSON.stringify(unreachable)}`);
        }
      }
    }
    case "rateFinding": {
      const body = await readCommand(req, res);
      if (body === undefined) return;
      const parsed = parseRatingBody(body);
      if (!parsed.ok) {
        writeJson(res, 400, { error: "invalid_request", field: parsed.field });
        return;
      }
      const result = await rateFinding({
        workspaceId: session.workspaceId,
        findingId: requiredParam(params, "findingId"),
        actor: session.actor,
        rating: parsed.value.rating,
        note: parsed.value.note,
      });
      switch (result.outcome) {
        case "rated":
        case "replaced":
        case "missing":
          writeJson(res, RATE_FINDING_STATUS[result.outcome], result);
          return;
        default: {
          const unreachable: never = result;
          throw new Error(`Unhandled rateFinding result ${JSON.stringify(unreachable)}`);
        }
      }
    }
    case "listFindingFeedback": {
      const result = await listFindingFeedback({
        adminToken: session.token,
        workspaceId: session.workspaceId,
        findingId: requiredParam(params, "findingId"),
      });
      switch (result.kind) {
        case "unauthorized":
          writeUnauthorized(res, LIST_FEEDBACK_STATUS.unauthorized);
          return;
        case "ok":
          writeJson(res, LIST_FEEDBACK_STATUS.ok, result);
          return;
        default: {
          const unreachable: never = result;
          throw new Error(`Unhandled listFindingFeedback result ${JSON.stringify(unreachable)}`);
        }
      }
    }
    case "listAuditEvents": {
      const objectType = optionalMember(url.searchParams, "objectType", AUDIT_OBJECT_TYPES);
      if (!objectType.ok) {
        writeJson(res, 400, { error: "invalid_request", field: objectType.field });
        return;
      }
      const objectId = optionalText(url.searchParams, "objectId");
      if (!objectId.ok) {
        writeJson(res, 400, { error: "invalid_request", field: objectId.field });
        return;
      }
      const result = await listAuditEvents({
        adminToken: session.token,
        workspaceId: session.workspaceId,
        ...(objectType.value === null ? {} : { objectType: objectType.value }),
        ...(objectId.value === null ? {} : { objectId: objectId.value }),
      });
      switch (result.kind) {
        case "unauthorized":
          writeUnauthorized(res, LIST_AUDIT_STATUS.unauthorized);
          return;
        case "ok":
          writeJson(res, LIST_AUDIT_STATUS.ok, result);
          return;
        default: {
          const unreachable: never = result;
          throw new Error(`Unhandled listAuditEvents result ${JSON.stringify(unreachable)}`);
        }
      }
    }
    default: {
      const unreachable: never = route;
      throw new Error(`Unhandled admin route ${JSON.stringify(unreachable)}`);
    }
  }
}

function adminSession(req: IncomingMessage): AdminSession | null {
  const token = bearerToken(req);
  const workspaceId = config.workspaceId;
  if (token === null || !verifyAdminToken(token) || workspaceId.trim().length === 0) {
    return null;
  }
  return { token, workspaceId, actor: config.adminActor };
}

function parseEventQuery(
  params: URLSearchParams,
): Parsed<{ cursor: string | null; limit: number | undefined; filters: EventFilters }> {
  const cursor = optionalText(params, "cursor");
  if (!cursor.ok) return cursor;
  const limit = parseLimit(params);
  if (!limit.ok) return limit;
  const integrationId = optionalText(params, "integrationId");
  if (!integrationId.ok) return integrationId;
  const from = optionalInstant(params, "from");
  if (!from.ok) return from;
  const to = optionalInstant(params, "to");
  if (!to.ok) return to;
  if (from.value !== null && to.value !== null && from.value.getTime() > to.value.getTime()) {
    return { ok: false, field: "from" };
  }
  const externalEventId = optionalText(params, "externalEventId");
  if (!externalEventId.ok) return externalEventId;
  const status = optionalMember(params, "status", PROCESSING_STATES);
  if (!status.ok) return status;
  const errorClass = optionalMember(params, "errorClass", FAILURE_CLASSES);
  if (!errorClass.ok) return errorClass;
  const failureClass = optionalMember(params, "failureClass", FAILURE_CLASSES);
  if (!failureClass.ok) return failureClass;
  if (
    errorClass.value !== null &&
    failureClass.value !== null &&
    errorClass.value !== failureClass.value
  ) {
    return { ok: false, field: "failureClass" };
  }
  const traceId = optionalText(params, "traceId");
  if (!traceId.ok) return traceId;

  const filters: EventFilters = {};
  if (integrationId.value !== null) filters.integrationId = integrationId.value;
  if (from.value !== null) filters.from = from.value;
  if (to.value !== null) filters.to = to.value;
  if (externalEventId.value !== null) filters.externalEventId = externalEventId.value;
  if (status.value !== null) filters.status = status.value;
  if (errorClass.value !== null) filters.errorClass = errorClass.value;
  if (failureClass.value !== null) filters.failureClass = failureClass.value;
  if (traceId.value !== null) filters.traceId = traceId.value;
  return {
    ok: true,
    value: { cursor: cursor.value, limit: limit.value, filters },
  };
}

function parseLimit(params: URLSearchParams): Parsed<number | undefined> {
  if (!params.has("limit")) return { ok: true, value: undefined };
  const raw = params.get("limit");
  if (raw === null || !/^[1-9]\d*$/.test(raw)) return { ok: false, field: "limit" };
  const limit = Number(raw);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_EVENT_PAGE_SIZE) {
    return { ok: false, field: "limit" };
  }
  return { ok: true, value: limit };
}

function optionalText(params: URLSearchParams, key: string): Parsed<string | null> {
  if (!params.has(key)) return { ok: true, value: null };
  const raw = params.get(key);
  if (raw === null || raw.length === 0 || raw !== raw.trim()) return { ok: false, field: key };
  return { ok: true, value: raw };
}

function optionalInstant(params: URLSearchParams, key: string): Parsed<Date | null> {
  if (!params.has(key)) return { ok: true, value: null };
  const raw = params.get(key);
  if (raw === null || raw.length === 0 || raw !== raw.trim() || Number.isNaN(Date.parse(raw))) {
    return { ok: false, field: key };
  }
  return { ok: true, value: new Date(raw) };
}

function optionalMember<T extends string>(
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

function parseStatusBody(body: Record<string, unknown>): Parsed<IncidentStatus> {
  for (const key of Object.keys(body)) {
    if (key !== "status") return { ok: false, field: key };
  }
  const raw = body["status"];
  if (typeof raw !== "string") return { ok: false, field: "status" };
  const status = INCIDENT_STATUSES.find((item) => item === raw);
  if (status === undefined) return { ok: false, field: "status" };
  return { ok: true, value: status };
}

function parseRatingBody(
  body: Record<string, unknown>,
): Parsed<{ rating: FeedbackRating; note: string | null }> {
  for (const key of Object.keys(body)) {
    if (key !== "rating" && key !== "note") return { ok: false, field: key };
  }
  const raw = body["rating"];
  if (typeof raw !== "string") return { ok: false, field: "rating" };
  const rating = FEEDBACK_RATINGS.find((item) => item === raw);
  if (rating === undefined) return { ok: false, field: "rating" };
  let note: string | null = null;
  if (Object.hasOwn(body, "note")) {
    const rawNote = body["note"];
    if (rawNote !== null && typeof rawNote !== "string") return { ok: false, field: "note" };
    note = rawNote;
  }
  return { ok: true, value: { rating, note } };
}

function queryProblem(params: URLSearchParams, allowed: readonly string[]): string | null {
  const seen = new Set<string>();
  for (const key of params.keys()) {
    if (seen.has(key) || !allowed.some((item) => item === key)) return key;
    seen.add(key);
  }
  return null;
}

async function readCommand(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<Record<string, unknown> | undefined> {
  if (!isJsonContentType(firstHeader(req, "content-type"))) {
    writeJson(res, 415, { error: "unsupported_media_type" });
    return undefined;
  }
  const bytes = await readCapped(req, JSON_BODY_LIMIT + 1);
  if (bytes.length > JSON_BODY_LIMIT) {
    writeJson(res, 413, { error: "payload_too_large" });
    return undefined;
  }
  const parsed = parseJsonObject(bytes);
  if (!parsed.ok) {
    writeJson(res, 400, { error: "invalid_request", field: parsed.field });
    return undefined;
  }
  return parsed.value;
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

function compile(route: Route): CompiledRoute {
  const pattern = route.path.split("/").filter((segment) => segment.length > 0);
  return {
    route,
    match(pathname: string): Readonly<Record<string, string>> | null {
      const parts = pathname.split("/").filter((segment) => segment.length > 0);
      if (parts.length !== pattern.length) return null;
      const params: Record<string, string> = {};
      for (let index = 0; index < pattern.length; index += 1) {
        const expected = pattern[index];
        const actual = parts[index];
        if (expected === undefined || actual === undefined) return null;
        if (expected.startsWith(":")) {
          let value: string;
          try {
            value = decodeURIComponent(actual);
          } catch {
            return null;
          }
          if (value.length === 0) return null;
          params[expected.slice(1)] = value;
        } else if (actual !== expected) {
          return null;
        }
      }
      return params;
    },
  };
}

function readCapped(req: IncomingMessage, cap: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;
    const finish = (bytes: Buffer) => {
      if (settled) return;
      settled = true;
      req.removeListener("data", onData);
      req.removeListener("end", onEnd);
      req.removeListener("error", onError);
      resolve(bytes);
    };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      req.removeListener("data", onData);
      req.removeListener("end", onEnd);
      req.removeListener("error", onError);
      reject(error);
    };
    const onData = (chunk: Buffer | string) => {
      if (settled || total >= cap) return;
      const buf = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
      const room = cap - total;
      if (buf.length > room) {
        chunks.push(buf.subarray(0, room));
        total = cap;
        return;
      }
      chunks.push(buf);
      total += buf.length;
    };
    const onEnd = () => finish(Buffer.concat(chunks, total));
    const onError = (error: Error) => fail(error);
    req.on("data", onData);
    req.on("end", onEnd);
    req.on("error", onError);
  });
}

function flatHeaders(req: IncomingMessage): Readonly<Record<string, string>> {
  const headers: Record<string, string> = {};
  const raw = req.rawHeaders;
  for (let index = 0; index < raw.length; index += 2) {
    const name = raw[index];
    const value = raw[index + 1];
    if (name === undefined || value === undefined) continue;
    const key = name.toLowerCase();
    if (key === "authorization" || key === "cookie") continue;
    if (headers[key] === undefined) headers[key] = value;
  }
  return headers;
}

function firstHeader(req: IncomingMessage, name: string): string | undefined {
  const wanted = name.toLowerCase();
  const raw = req.rawHeaders;
  for (let index = 0; index < raw.length; index += 2) {
    const key = raw[index];
    if (key !== undefined && key.toLowerCase() === wanted) return raw[index + 1];
  }
  return undefined;
}

function bearerToken(req: IncomingMessage): string | null {
  const raw = firstHeader(req, "authorization");
  if (raw === undefined) return null;
  const matched = /^Bearer (\S+)$/i.exec(raw);
  const token = matched?.[1];
  if (token === undefined || token.length === 0) return null;
  return token;
}

function requiredParam(params: Readonly<Record<string, string>>, name: string): string {
  const value = params[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`Missing path parameter ${name}`);
  }
  return value;
}

function writeUnauthorized(res: ServerResponse, status: number): void {
  writeJson(res, status, UNAUTHORIZED_BODY, { "WWW-Authenticate": "Bearer" });
}

function writeJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  extra?: Readonly<Record<string, string>>,
): void {
  if (res.headersSent || res.writableEnded) return;
  const payload = JSON.stringify(body);
  const headers: Record<string, string | number> = {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
  };
  if (extra !== undefined) {
    for (const [key, value] of Object.entries(extra)) headers[key] = value;
  }
  res.writeHead(status, headers);
  res.end(payload);
}

function formatHost(host: string): string {
  return host.includes(":") ? `[${host}]` : host;
}
