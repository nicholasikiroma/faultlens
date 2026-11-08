import { Server } from "node:http";
import { createAdaptorServer } from "@hono/node-server";
import { Hono } from "hono";
import { config } from "../config.ts";
import { handleListAuditEvents } from "./controllers/audit.controller.ts";
import { handleListAttempts, handleListEvents } from "./controllers/events.controller.ts";
import { handleListFindingFeedback, handleRateFinding } from "./controllers/feedback.controller.ts";
import { handleIngest } from "./controllers/ingest.controller.ts";
import {
  handleExportIncident,
  handleListIncidents,
  handleTransitionIncident,
} from "./controllers/incidents.controller.ts";
import {
  adminSession,
  headerPairs,
  invalidRequest,
  methodNotAllowed,
  queryProblem,
  unauthorized,
  type ApiContext,
  type ApiEnv,
} from "./request.ts";
import { ADMIN_QUERY_KEYS, ROUTES, type AdminRouteId, type Route } from "./routes.ts";

type AdminRoute = Extract<Route, { id: AdminRouteId }>;

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
      return dispatchAdmin(c, route);
    default: {
      const unreachable: never = route;
      throw new Error(`Unhandled route ${JSON.stringify(unreachable)}`);
    }
  }
}

async function dispatchAdmin(c: ApiContext, route: AdminRoute): Promise<Response> {
  const pairs = headerPairs(c);
  const session = adminSession(pairs);
  if (session === null) return unauthorized(c, 401);
  const params = new URL(c.req.url).searchParams;
  const queryField = queryProblem(params, ADMIN_QUERY_KEYS[route.id]);
  if (queryField !== null) return invalidRequest(c, queryField);

  switch (route.id) {
    case "listEvents":
      return handleListEvents(c, session, params);
    case "listAttempts":
      return handleListAttempts(c, session);
    case "listIncidents":
      return handleListIncidents(c, session, params);
    case "exportIncident":
      return handleExportIncident(c, session);
    case "transitionIncident":
      return handleTransitionIncident(c, session);
    case "rateFinding":
      return handleRateFinding(c, session);
    case "listFindingFeedback":
      return handleListFindingFeedback(c, session);
    case "listAuditEvents":
      return handleListAuditEvents(c, session, params);
    default: {
      const unreachable: never = route;
      throw new Error(`Unhandled admin route ${JSON.stringify(unreachable)}`);
    }
  }
}

function formatHost(host: string): string {
  return host.includes(":") ? `[${host}]` : host;
}
