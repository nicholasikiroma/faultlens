import { db } from "#db";
import type {
  DeliveryAttempt,
  Evidence,
  FailureClass,
  WebhookEvent,
} from "#domain";
import { verifyAdminToken } from "./auth.ts";
import {
  compareEventOrder,
  toDeliveryAttempt,
  toWebhookEvent,
} from "./events.ts";
import { toIncidentSummary, type IncidentSummary } from "./incidents.ts";

export interface ExportIncidentInput {
  adminToken: string | null | undefined;
  workspaceId: string;
  incidentId: string;
}

export interface ExportedFinding {
  id: string;
  eventId: string;
  ruleId: string;
  ruleVersion: string;
  failureClass: FailureClass;
  explanation: string;
  certainty: string;
  evidenceIds: readonly string[];
}

export type ExportIncidentResult =
  | { kind: "unauthorized" }
  | { kind: "missing" }
  | {
      kind: "ok";
      incidentId: string;
      incident: IncidentSummary;
      timeline: readonly WebhookEvent[];
      events: readonly WebhookEvent[];
      attempts: readonly DeliveryAttempt[];
      evidence: readonly Evidence[];
      findings: readonly ExportedFinding[];
    };

export async function exportIncident(
  input: ExportIncidentInput,
): Promise<ExportIncidentResult> {
  if (
    !verifyAdminToken(input.adminToken) ||
    input.workspaceId.trim().length === 0
  ) {
    return { kind: "unauthorized" };
  }

  const incidentRow = await db.orm.public.Incident.where({
    id: input.incidentId,
    workspaceId: input.workspaceId,
  }).first();

  if (incidentRow === null) {
    return { kind: "missing" };
  }

  const incidentEventLinks = await db.orm.public.IncidentEvent.where({
    incidentId: incidentRow.id,
  }).all();
  const linkedEventIds = new Set(incidentEventLinks.map((row) => row.eventId));

  const eventRows = (
    await db.orm.public.WebhookEvent.where({
      workspaceId: input.workspaceId,
    }).all()
  ).filter((row) => linkedEventIds.has(row.id));
  eventRows.sort(compareEventOrder);
  const timeline = eventRows.map((row) =>
    toWebhookEvent({
      ...row,
      // Export never exposes raw payloads; metadata-only keeps redactedPayloadJson null.
      redactedPayloadJson: null,
    }),
  );

  const validEventIds = new Set(eventRows.map((row) => row.id));
  const attemptRows = (
    await db.orm.public.DeliveryAttempt.where({
      workspaceId: input.workspaceId,
    }).all()
  ).filter(
    (row) => row.eventId !== null && validEventIds.has(row.eventId),
  );
  attemptRows.sort(
    (left, right) =>
      left.receivedAt.getTime() - right.receivedAt.getTime() ||
      left.id.localeCompare(right.id),
  );
  const attempts = attemptRows.map(toDeliveryAttempt);

  const findingRows = await db.orm.public.Finding.where({
    workspaceId: input.workspaceId,
    incidentId: incidentRow.id,
  }).all();
  findingRows.sort((left, right) => left.id.localeCompare(right.id));
  const findingIds = new Set(findingRows.map((row) => row.id));

  const workspaceEvidenceRows = await db.orm.public.Evidence.where({
    workspaceId: input.workspaceId,
  }).all();
  const evidenceById = new Map<string, Evidence>(
    workspaceEvidenceRows.map((row) => [
      row.id,
      {
        id: row.id,
        sourceKind: row.sourceKind,
        sourceRecordId: row.sourceRecordId,
        summary: row.summary,
        sha256Digest: row.sha256Digest,
        trustTier: row.trustTier,
      },
    ]),
  );

  const findingEvidenceLinks = (
    await db.orm.public.FindingEvidence.all()
  ).filter(
    (row) => findingIds.has(row.findingId) && evidenceById.has(row.evidenceId),
  );

  const citedEvidenceIds = new Set<string>();
  const findings: ExportedFinding[] = findingRows.map((finding) => {
    const evidenceIds = findingEvidenceLinks
      .filter((link) => link.findingId === finding.id)
      .map((link) => link.evidenceId)
      .sort((left, right) => left.localeCompare(right));
    for (const id of evidenceIds) {
      citedEvidenceIds.add(id);
    }
    return {
      id: finding.id,
      eventId: finding.eventId,
      ruleId: finding.ruleId,
      ruleVersion: finding.ruleVersion,
      failureClass: finding.failureClass,
      explanation: finding.explanation,
      certainty: finding.certainty,
      evidenceIds,
    };
  });

  const evidence = [...citedEvidenceIds]
    .sort((left, right) => left.localeCompare(right))
    .map((id) => evidenceById.get(id)!)
    .filter((item): item is Evidence => item !== undefined);

  return {
    kind: "ok",
    incidentId: incidentRow.id,
    incident: toIncidentSummary(incidentRow),
    timeline,
    events: timeline,
    attempts,
    evidence,
    findings,
  };
}
