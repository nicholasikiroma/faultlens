import { Server } from "node:http";
import { createAdaptorServer, type HttpBindings } from "@hono/node-server";
import { Hono, type Context } from "hono";
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

type ApiEnv = { Bindings: HttpBindings };
type ApiContext = Context<ApiEnv>;

interface AdminSession {
  readonly token: string;
  readonly workspaceId: string;
  readonly actor: string;
}

type AdminRoute = Extract<Route, { id: AdminRouteId }>;
type IngestRoute = Extract<Route, { id: "ingest" | "simulateWebhook" }>;
type HeaderPairs = readonly (readonly [string, string])[];

type Parsed<T> = { ok: true; value: T } | { ok: false; field: string };
type CommandBody =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; response: Response };

export function createApiApp(): Hono<ApiEnv> {
  const app = new Hono<ApiEnv>();
  const mounted = ROUTES.filter(isMounted);
  const methodsByPath = new Map<string, string[]>();
  for (const route of mounted) {
    const methods = methodsByPath.get(route.path) ?? [];
    if (!methods.includes(route.method)) methods.push(route.method);
    methodsByPath.set(route.path, methods);
  }
  for (const route of mounted) {
    const allow = (methodsByPath.get(route.path) ?? [route.method]).join(", ");
    app.on(route.method, route.path, (c) => {
      if (c.req.method !== route.method) return methodNotAllowed(c, allow);
      return dispatch(c, route);
    });
  }
  for (const [path, methods] of methodsByPath) {
    const allow = methods.join(", ");
    app.on("ALL", path, (c) => methodNotAllowed(c, allow));
  }
  app.notFound((c) => c.json({ error: "not_found" }, 404));
  app.onError((error, c) => {
    console.error(error);
    return c.json({ error: "internal" }, 500);
  });
  return app;
}

export function createApiServer(): Server {
  const server = createAdaptorServer({ fetch: createApiApp().fetch });
  if (!(server instanceof Server)) {
    throw new Error("Expected an HTTP server");
  }
  return server;
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

function dispatch(c: ApiContext, route: Route): Promise<Response> {
  switch (route.id) {
    case "ingest":
    case "simulateWebhook":
      return handleIngest(c, route);
    case "listEvents":
    case "listAttempts":
    case "listIncidents":
    case "exportIncident":
    case "transitionIncident":
    case "rateFinding":
    case "listFindingFeedback":
    case "listAuditEvents":
      return handleAdmin(c, route);
    default: {
      const unreachable: never = route;
      throw new Error(`Unhandled route ${JSON.stringify(unreachable)}`);
    }
  }
}

async function handleIngest(c: ApiContext, route: IngestRoute): Promise<Response> {
  const pairs = headerPairs(c);
  const rawBody = await readCapped(c.req.raw, RAW_READ_CAP);
  const result = await ingest({
    token: ingestCredential(route, c, pairs),
    rawBody,
    headers: flatHeaders(pairs),
  });
  switch (result.outcome) {
    case "stored":
    case "duplicate":
    case "conflict":
    case "rejected":
    case "schema-error":
    case "oversized":
    case "unknown-token":
      return c.json(result, INGEST_STATUS[result.outcome]);
    default: {
      const unreachable: never = result;
      throw new Error(`Unhandled ingest result ${JSON.stringify(unreachable)}`);
    }
  }
}

function ingestCredential(route: IngestRoute, c: ApiContext, pairs: HeaderPairs): string {
  switch (route.access.credential) {
    case "bearer":
      return bearerToken(pairs) ?? "";
    case "path":
      return requiredParam(c.req.param(), "token");
    default: {
      const unreachable: never = route.access;
      return unreachable;
    }
  }
}

async function handleAdmin(c: ApiContext, route: AdminRoute): Promise<Response> {
  const pairs = headerPairs(c);
  const session = adminSession(pairs);
  if (session === null) return unauthorized(c, 401);
  const params = new URL(c.req.url).searchParams;
  const queryField = queryProblem(params, ADMIN_QUERY_KEYS[route.id]);
  if (queryField !== null) {
    return c.json({ error: "invalid_request", field: queryField }, 400);
  }

  switch (route.id) {
    case "listEvents": {
      const parsed = parseEventQuery(params);
      if (!parsed.ok) return c.json({ error: "invalid_request", field: parsed.field }, 400);
      const result = await listEvents({
        adminToken: session.token,
        workspaceId: session.workspaceId,
        cursor: parsed.value.cursor,
        limit: parsed.value.limit,
        filters: parsed.value.filters,
      });
      switch (result.kind) {
        case "unauthorized":
          return unauthorized(c, LIST_EVENTS_STATUS.unauthorized);
        case "ok":
          return c.json(result, LIST_EVENTS_STATUS.ok);
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
        eventId: requiredParam(c.req.param(), "eventId"),
      });
      switch (result.kind) {
        case "unauthorized":
          return unauthorized(c, LIST_ATTEMPTS_STATUS.unauthorized);
        case "ok":
          return c.json(result, LIST_ATTEMPTS_STATUS.ok);
        default: {
          const unreachable: never = result;
          throw new Error(`Unhandled listAttempts result ${JSON.stringify(unreachable)}`);
        }
      }
    }
    case "listIncidents": {
      const failureClass = optionalMember(params, "failureClass", FAILURE_CLASSES);
      if (!failureClass.ok) return c.json({ error: "invalid_request", field: failureClass.field }, 400);
      const result = await listIncidents({
        adminToken: session.token,
        workspaceId: session.workspaceId,
        failureClass: failureClass.value,
      });
      switch (result.kind) {
        case "unauthorized":
          return unauthorized(c, LIST_INCIDENTS_STATUS.unauthorized);
        case "ok":
          return c.json(result, LIST_INCIDENTS_STATUS.ok);
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
        incidentId: requiredParam(c.req.param(), "incidentId"),
      });
      switch (result.kind) {
        case "unauthorized":
          return unauthorized(c, EXPORT_INCIDENT_STATUS.unauthorized);
        case "missing":
          return c.json(result, EXPORT_INCIDENT_STATUS.missing);
        case "ok":
          return c.json(result, EXPORT_INCIDENT_STATUS.ok);
        default: {
          const unreachable: never = result;
          throw new Error(`Unhandled exportIncident result ${JSON.stringify(unreachable)}`);
        }
      }
    }
    case "transitionIncident": {
      const body = await readCommand(c, pairs);
      if (!body.ok) return body.response;
      const parsed = parseStatusBody(body.value);
      if (!parsed.ok) return c.json({ error: "invalid_request", field: parsed.field }, 400);
      const result = await transitionIncident({
        workspaceId: session.workspaceId,
        incidentId: requiredParam(c.req.param(), "incidentId"),
        status: parsed.value,
        actor: session.actor,
      });
      switch (result.outcome) {
        case "transitioned":
        case "unchanged":
        case "illegal":
        case "missing":
          return c.json(result, TRANSITION_STATUS[result.outcome]);
        default: {
          const unreachable: never = result;
          throw new Error(`Unhandled transition result ${JSON.stringify(unreachable)}`);
        }
      }
    }
    case "rateFinding": {
      const body = await readCommand(c, pairs);
      if (!body.ok) return body.response;
      const parsed = parseRatingBody(body.value);
      if (!parsed.ok) return c.json({ error: "invalid_request", field: parsed.field }, 400);
      const result = await rateFinding({
        workspaceId: session.workspaceId,
        findingId: requiredParam(c.req.param(), "findingId"),
        actor: session.actor,
        rating: parsed.value.rating,
        note: parsed.value.note,
      });
      switch (result.outcome) {
        case "rated":
        case "replaced":
        case "missing":
          return c.json(result, RATE_FINDING_STATUS[result.outcome]);
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
        findingId: requiredParam(c.req.param(), "findingId"),
      });
      switch (result.kind) {
        case "unauthorized":
          return unauthorized(c, LIST_FEEDBACK_STATUS.unauthorized);
        case "ok":
          return c.json(result, LIST_FEEDBACK_STATUS.ok);
        default: {
          const unreachable: never = result;
          throw new Error(`Unhandled listFindingFeedback result ${JSON.stringify(unreachable)}`);
        }
      }
    }
    case "listAuditEvents": {
      const objectType = optionalMember(params, "objectType", AUDIT_OBJECT_TYPES);
      if (!objectType.ok) return c.json({ error: "invalid_request", field: objectType.field }, 400);
      const objectId = optionalText(params, "objectId");
      if (!objectId.ok) return c.json({ error: "invalid_request", field: objectId.field }, 400);
      const result = await listAuditEvents({
        adminToken: session.token,
        workspaceId: session.workspaceId,
        ...(objectType.value === null ? {} : { objectType: objectType.value }),
        ...(objectId.value === null ? {} : { objectId: objectId.value }),
      });
      switch (result.kind) {
        case "unauthorized":
          return unauthorized(c, LIST_AUDIT_STATUS.unauthorized);
        case "ok":
          return c.json(result, LIST_AUDIT_STATUS.ok);
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

function adminSession(pairs: HeaderPairs): AdminSession | null {
  const token = bearerToken(pairs);
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

async function readCommand(c: ApiContext, pairs: HeaderPairs): Promise<CommandBody> {
  if (!isJsonContentType(firstHeader(pairs, "content-type"))) {
    return { ok: false, response: c.json({ error: "unsupported_media_type" }, 415) };
  }
  const bytes = await readCapped(c.req.raw, JSON_BODY_LIMIT + 1);
  if (bytes.length > JSON_BODY_LIMIT) {
    return { ok: false, response: c.json({ error: "payload_too_large" }, 413) };
  }
  const parsed = parseJsonObject(bytes);
  if (!parsed.ok) {
    return { ok: false, response: c.json({ error: "invalid_request", field: parsed.field }, 400) };
  }
  return { ok: true, value: parsed.value };
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

function readCapped(request: Request, cap: number): Promise<Buffer> {
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

function headerPairs(c: ApiContext): HeaderPairs {
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

function flatHeaders(pairs: HeaderPairs): Readonly<Record<string, string>> {
  const headers: Record<string, string> = {};
  for (const [name, value] of pairs) {
    const key = name.toLowerCase();
    if (key === "authorization" || key === "cookie") continue;
    if (headers[key] === undefined) headers[key] = value;
  }
  return headers;
}

function firstHeader(pairs: HeaderPairs, name: string): string | undefined {
  const wanted = name.toLowerCase();
  for (const [key, value] of pairs) {
    if (key.toLowerCase() === wanted) return value;
  }
  return undefined;
}

function bearerToken(pairs: HeaderPairs): string | null {
  const raw = firstHeader(pairs, "authorization");
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

function unauthorized(c: ApiContext, status: 401): Response {
  return c.json(UNAUTHORIZED_BODY, status, { "WWW-Authenticate": "Bearer" });
}

function methodNotAllowed(c: ApiContext, allow: string): Response {
  return c.json({ error: "method_not_allowed" }, 405, { Allow: allow });
}

function formatHost(host: string): string {
  return host.includes(":") ? `[${host}]` : host;
}
