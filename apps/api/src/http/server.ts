import { Server } from "node:http";
import { createAdaptorServer } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { config } from "../config.ts";
import { handleListAuditEvents } from "./controllers/audit.controller.ts";
import {
  handleListAttempts,
  handleListEvents,
} from "./controllers/events.controller.ts";
import {
  handleListFindingFeedback,
  handleRateFinding,
} from "./controllers/feedback.controller.ts";
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
  type AdminSession,
  type ApiContext,
  type ApiEnv,
} from "./request.ts";
import {
  ADMIN_QUERY_KEYS,
  ROUTES,
  type AdminRouteId,
  type Route,
} from "./routes.ts";

type AdminHandler = (
  c: ApiContext,
  session: AdminSession,
  params: URLSearchParams,
) => Promise<Response>;

const adminHandlers = {
  listEvents: handleListEvents,
  listAttempts: handleListAttempts,
  listIncidents: handleListIncidents,
  exportIncident: handleExportIncident,
  transitionIncident: handleTransitionIncident,
  rateFinding: handleRateFinding,
  listFindingFeedback: handleListFindingFeedback,
  listAuditEvents: handleListAuditEvents,
} satisfies Record<AdminRouteId, AdminHandler>;

export function createApiApp(): Hono<ApiEnv> {
  const app = new Hono<ApiEnv>();
  app.use(
    "*",
    cors({
      origin: (origin) => {
        if (!origin) return "*";
        if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
          return origin;
        }
        return config.corsOrigin ?? origin;
      },
      allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      allowHeaders: [
        "Content-Type",
        "Authorization",
        "x-wiresleuth-signature",
        "x-wiresleuth-episode",
      ],
      exposeHeaders: ["Content-Length", "x-wiresleuth-signature"],
      maxAge: 86400,
      credentials: true,
    }),
  );
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
}): Promise<{
  server: Server;
  url: string;
  close: (graceMs?: number) => Promise<void>;
}> {
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
    close: (graceMs = 10_000) => closeServer(server, graceMs),
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
  if (route.id === "ingest" || route.id === "simulateWebhook") {
    return handleIngest(c, route);
  }
  return dispatchAdmin(c, route.id);
}

async function dispatchAdmin(
  c: ApiContext,
  id: AdminRouteId,
): Promise<Response> {
  const pairs = headerPairs(c);
  const session = adminSession(pairs);
  if (session === null) return unauthorized(c, 401);
  const params = new URL(c.req.url).searchParams;
  const queryField = queryProblem(params, ADMIN_QUERY_KEYS[id]);
  if (queryField !== null) return invalidRequest(c, queryField);

  return adminHandlers[id](c, session, params);
}

export function closeServer(server: Server, graceMs = 10_000): Promise<void> {
  if (!Number.isFinite(graceMs) || graceMs < 0) {
    return Promise.reject(new Error("Invalid shutdown grace period"));
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => server.closeAllConnections(), graceMs);
    timer.unref();
    server.close((error) => {
      clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    });
    if (graceMs === 0) server.closeAllConnections();
  });
}

function formatHost(host: string): string {
  return host.includes(":") ? `[${host}]` : host;
}
