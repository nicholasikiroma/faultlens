import { db } from "#db";
import type { FailureClass, IncidentStatus } from "#domain";
import {
  canTransitionIncident,
  transitionIncident,
  type TransitionIncidentInput,
  type TransitionIncidentResult,
} from "../incidents/lifecycle.ts";
import { verifyAdminToken } from "./auth.ts";

export {
  canTransitionIncident,
  transitionIncident,
  type TransitionIncidentInput,
  type TransitionIncidentResult,
};

export interface IncidentSummary {
  id: string;
  workspaceId: string;
  integrationId: string;
  environment: string;
  endpoint: string;
  fingerprint: string;
  ruleVersion: string;
  failureClass: FailureClass;
  status: IncidentStatus;
  firstSeenAt: Date;
  lastSeenAt: Date;
  eventCount: number;
}

export interface ListIncidentsInput {
  adminToken: string | null | undefined;
  workspaceId: string;
  failureClass?: FailureClass | null;
}

export type ListIncidentsResult =
  | { kind: "unauthorized" }
  | {
      kind: "ok";
      items: readonly IncidentSummary[];
    };

export async function listIncidents(
  input: ListIncidentsInput,
): Promise<ListIncidentsResult> {
  if (
    !verifyAdminToken(input.adminToken) ||
    input.workspaceId.trim().length === 0
  ) {
    return { kind: "unauthorized" };
  }

  const failureClass = input.failureClass ?? null;
  const rows = await db.orm.public.Incident.where({
    workspaceId: input.workspaceId,
    ...(failureClass !== null ? { failureClass } : {}),
  }).all();

  rows.sort(
    (left, right) =>
      right.lastSeenAt.getTime() - left.lastSeenAt.getTime() ||
      right.firstSeenAt.getTime() - left.firstSeenAt.getTime() ||
      left.id.localeCompare(right.id),
  );

  return {
    kind: "ok",
    items: rows.map(toIncidentSummary),
  };
}

export function toIncidentSummary(row: {
  id: string;
  workspaceId: string;
  integrationId: string;
  environment: string;
  endpoint: string;
  fingerprint: string;
  ruleVersion: string;
  failureClass: FailureClass;
  status: IncidentStatus;
  firstSeenAt: Date;
  lastSeenAt: Date;
  eventCount: number;
}): IncidentSummary {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    integrationId: row.integrationId,
    environment: row.environment,
    endpoint: row.endpoint,
    fingerprint: row.fingerprint,
    ruleVersion: row.ruleVersion,
    failureClass: row.failureClass,
    status: row.status,
    firstSeenAt: row.firstSeenAt,
    lastSeenAt: row.lastSeenAt,
    eventCount: row.eventCount,
  };
}
