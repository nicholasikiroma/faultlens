import { FAILURE_CLASSES, INCIDENT_STATUSES, type IncidentStatus } from "#domain";
import { transitionIncident } from "../../incidents/lifecycle.ts";
import { exportIncident } from "../../read/export.ts";
import { listIncidents } from "../../read/incidents.ts";
import {
  headerPairs,
  invalidRequest,
  optionalMember,
  readCommand,
  requiredParam,
  unauthorized,
  type AdminSession,
  type ApiContext,
  type Parsed,
} from "../request.ts";
import { EXPORT_INCIDENT_STATUS, LIST_INCIDENTS_STATUS, TRANSITION_STATUS } from "../routes.ts";

export async function handleListIncidents(
  c: ApiContext,
  session: AdminSession,
  params: URLSearchParams,
): Promise<Response> {
  const failureClass = optionalMember(params, "failureClass", FAILURE_CLASSES);
  if (!failureClass.ok) return invalidRequest(c, failureClass.field);
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

export async function handleExportIncident(
  c: ApiContext,
  session: AdminSession,
): Promise<Response> {
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

export async function handleTransitionIncident(
  c: ApiContext,
  session: AdminSession,
): Promise<Response> {
  const body = await readCommand(c, headerPairs(c));
  if (!body.ok) return body.response;
  const parsed = parseStatusBody(body.value);
  if (!parsed.ok) return invalidRequest(c, parsed.field);
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
