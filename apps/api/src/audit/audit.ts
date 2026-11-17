import { randomUUID } from "node:crypto";
import { db } from "#db";
import {
  AUDIT_OBJECT_TYPE,
  FEEDBACK_RATINGS,
  HYPOTHESIS_FEEDBACK_RATINGS,
  INCIDENT_TRANSITIONS,
  RUN_STATES,
  type AuditAction,
  type AuditEvent,
  type AuditObjectType,
  type FeedbackRating,
  type HypothesisFeedbackRating,
  type IncidentStatus,
  type RunState,
} from "#domain";
import { verifyAdminToken } from "../read/auth.ts";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type AuditEntry =
  | {
      action: "INCIDENT_STATUS_CHANGED";
      workspaceId: string;
      actor: string;
      objectId: string;
      oldState: IncidentStatus;
      newState: IncidentStatus;
    }
  | {
      action: "FINDING_RATED";
      workspaceId: string;
      actor: string;
      objectId: string;
      oldState: FeedbackRating | null;
      newState: FeedbackRating;
    }
  | {
      action: "HYPOTHESIS_RATED";
      workspaceId: string;
      actor: string;
      objectId: string;
      oldState: HypothesisFeedbackRating | null;
      newState: HypothesisFeedbackRating;
    }
  | {
      action: "AI_INVESTIGATION_REQUESTED";
      workspaceId: string;
      actor: string;
      objectId: string;
      oldState: RunState | null;
      newState: RunState;
    };

export interface AuditRow {
  id: string;
  workspaceId: string;
  actor: string;
  action: AuditAction;
  objectType: AuditObjectType;
  objectId: string;
  oldState: string | null;
  newState: string | null;
  timestamp: Date;
}

export interface ListAuditEventsInput {
  adminToken: string | null | undefined;
  workspaceId: string;
  objectType?: AuditObjectType;
  objectId?: string;
}

export type ListAuditEventsResult =
  | { kind: "unauthorized" }
  | { kind: "ok"; items: readonly AuditEvent[] };

export async function recordAudit(
  tx: Tx,
  entry: AuditEntry,
  timestamp: Date = new Date(),
): Promise<void> {
  await tx.orm.public.AuditEvent.create({
    id: randomUUID(),
    workspaceId: entry.workspaceId,
    actor: entry.actor,
    action: entry.action,
    objectType: AUDIT_OBJECT_TYPE[entry.action],
    objectId: entry.objectId,
    oldState: entry.oldState,
    newState: entry.newState,
    timestamp,
  });
}

export async function listAuditEvents(
  input: ListAuditEventsInput,
): Promise<ListAuditEventsResult> {
  if (
    !verifyAdminToken(input.adminToken) ||
    input.workspaceId.trim().length === 0
  ) {
    return { kind: "unauthorized" };
  }

  const objectType = input.objectType;
  const objectId = input.objectId;
  const rows = (await db.orm.public.AuditEvent.all()).filter(
    (row) =>
      row.workspaceId === input.workspaceId &&
      (objectType === undefined || row.objectType === objectType) &&
      (objectId === undefined || row.objectId === objectId),
  );

  rows.sort(
    (left, right) =>
      left.timestamp.getTime() - right.timestamp.getTime() ||
      left.id.localeCompare(right.id),
  );

  return { kind: "ok", items: rows.map(toAuditEvent) };
}

export function toAuditEvent(row: AuditRow): AuditEvent {
  if (row.objectType !== AUDIT_OBJECT_TYPE[row.action]) {
    throw new Error(`audit row ${row.id} has invalid object type`);
  }

  switch (row.action) {
    case "INCIDENT_STATUS_CHANGED":
      return {
        id: row.id,
        workspaceId: row.workspaceId,
        actor: row.actor,
        action: row.action,
        objectType: AUDIT_OBJECT_TYPE[row.action],
        objectId: row.objectId,
        oldState: parseIncidentStatus(row.oldState, row.id),
        newState: parseIncidentStatus(row.newState, row.id),
        timestamp: row.timestamp,
      };
    case "FINDING_RATED":
      return {
        id: row.id,
        workspaceId: row.workspaceId,
        actor: row.actor,
        action: row.action,
        objectType: AUDIT_OBJECT_TYPE[row.action],
        objectId: row.objectId,
        oldState:
          row.oldState === null
            ? null
            : parseFeedbackRating(row.oldState, row.id),
        newState: parseFeedbackRating(row.newState, row.id),
        timestamp: row.timestamp,
      };
    case "HYPOTHESIS_RATED":
      return {
        id: row.id,
        workspaceId: row.workspaceId,
        actor: row.actor,
        action: row.action,
        objectType: AUDIT_OBJECT_TYPE[row.action],
        objectId: row.objectId,
        oldState:
          row.oldState === null
            ? null
            : parseHypothesisFeedbackRating(row.oldState, row.id),
        newState: parseHypothesisFeedbackRating(row.newState, row.id),
        timestamp: row.timestamp,
      };
    case "AI_INVESTIGATION_REQUESTED":
      return {
        id: row.id,
        workspaceId: row.workspaceId,
        actor: row.actor,
        action: row.action,
        objectType: AUDIT_OBJECT_TYPE[row.action],
        objectId: row.objectId,
        oldState:
          row.oldState === null ? null : parseRunState(row.oldState, row.id),
        newState: parseRunState(row.newState, row.id),
        timestamp: row.timestamp,
      };
    default: {
      const unexpected: never = row.action;
      throw new Error(
        `audit row ${row.id} has unknown action ${String(unexpected)}`,
      );
    }
  }
}

function parseIncidentStatus(
  value: string | null,
  id: string,
): IncidentStatus {
  if (value !== null && isIncidentStatus(value)) {
    return value;
  }
  throw new Error(`audit row ${id} has invalid incident status`);
}

function parseFeedbackRating(
  value: string | null,
  id: string,
): FeedbackRating {
  if (value !== null && isFeedbackRating(value)) {
    return value;
  }
  throw new Error(`audit row ${id} has invalid feedback rating`);
}

function parseHypothesisFeedbackRating(
  value: string | null,
  id: string,
): HypothesisFeedbackRating {
  if (value !== null && isHypothesisFeedbackRating(value)) {
    return value;
  }
  throw new Error(`audit row ${id} has invalid hypothesis feedback rating`);
}

function parseRunState(value: string | null, id: string): RunState {
  if (value !== null && (RUN_STATES as readonly string[]).includes(value)) {
    return value as RunState;
  }
  throw new Error(`audit row ${id} has invalid run state`);
}

function isIncidentStatus(value: string): value is IncidentStatus {
  return Object.hasOwn(INCIDENT_TRANSITIONS, value);
}

function isFeedbackRating(value: string): value is FeedbackRating {
  return (FEEDBACK_RATINGS as readonly string[]).includes(value);
}

function isHypothesisFeedbackRating(
  value: string,
): value is HypothesisFeedbackRating {
  return (HYPOTHESIS_FEEDBACK_RATINGS as readonly string[]).includes(value);
}
