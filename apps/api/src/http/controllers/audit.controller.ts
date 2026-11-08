import { AUDIT_OBJECT_TYPES } from "#domain";
import { listAuditEvents } from "../../audit/audit.ts";
import {
  invalidRequest,
  optionalMember,
  optionalText,
  unauthorized,
  type AdminSession,
  type ApiContext,
} from "../request.ts";
import { LIST_AUDIT_STATUS } from "../routes.ts";

export async function handleListAuditEvents(
  c: ApiContext,
  session: AdminSession,
  params: URLSearchParams,
): Promise<Response> {
  const objectType = optionalMember(params, "objectType", AUDIT_OBJECT_TYPES);
  if (!objectType.ok) return invalidRequest(c, objectType.field);
  const objectId = optionalText(params, "objectId");
  if (!objectId.ok) return invalidRequest(c, objectId.field);
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
