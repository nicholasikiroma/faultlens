import { FAILURE_CLASSES, PROCESSING_STATES } from "#domain";
import { listAttempts, listEvents, type EventFilters } from "../../read/events.ts";
import {
  invalidRequest,
  optionalInstant,
  optionalMember,
  optionalText,
  parseLimit,
  requiredParam,
  unauthorized,
  type AdminSession,
  type ApiContext,
  type Parsed,
} from "../request.ts";
import { LIST_ATTEMPTS_STATUS, LIST_EVENTS_STATUS } from "../routes.ts";

export async function handleListEvents(
  c: ApiContext,
  session: AdminSession,
  params: URLSearchParams,
): Promise<Response> {
  const parsed = parseEventQuery(params);
  if (!parsed.ok) return invalidRequest(c, parsed.field);
  const result = await listEvents({
    adminToken: session.token,
    workspaceId: session.workspaceId,
    cursor: parsed.value.cursor,
    limit: parsed.value.limit,
    filters: parsed.value.filters,
  });
  if (result.kind === "unauthorized") return unauthorized(c, LIST_EVENTS_STATUS.unauthorized);
  return c.json(result, LIST_EVENTS_STATUS[result.kind]);
}

export async function handleListAttempts(c: ApiContext, session: AdminSession): Promise<Response> {
  const result = await listAttempts({
    adminToken: session.token,
    workspaceId: session.workspaceId,
    eventId: requiredParam(c.req.param(), "eventId"),
  });
  if (result.kind === "unauthorized") return unauthorized(c, LIST_ATTEMPTS_STATUS.unauthorized);
  return c.json(result, LIST_ATTEMPTS_STATUS[result.kind]);
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
