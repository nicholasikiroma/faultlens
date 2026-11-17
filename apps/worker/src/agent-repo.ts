import { db } from '#db';
import type {
  AgentToolRepository,
  FindingRecordView,
  IncidentRecordView,
  IntegrationConfigSummaryView,
} from '#agent';
import type { DeliveryAttempt, Evidence, WebhookEvent } from '#domain';

/**
 * Workspace-scoped, strictly read-only PostgreSQL implementation of AgentToolRepository.
 * Signing secrets and key hashes are never queried or returned.
 */
export function createPostgresAgentRepository(): AgentToolRepository {
  return {
    async getIncident(workspaceId, incidentId): Promise<IncidentRecordView | null> {
      const row = await db.orm.public.Incident.where({
        id: incidentId,
        workspaceId,
      }).first();
      if (!row) return null;
      return {
        id: row.id,
        workspaceId: row.workspaceId,
        fingerprint: row.fingerprint,
        integrationId: row.integrationId,
        environment: row.environment,
        failureClass: row.failureClass,
        endpoint: row.endpoint,
        ruleVersion: row.ruleVersion,
        status: row.status,
        firstSeenAt: row.firstSeenAt,
        lastSeenAt: row.lastSeenAt,
        eventCount: row.eventCount,
      };
    },

    async listIncidentEventsAndAttempts(workspaceId, incidentId, limit) {
      const incident = await db.orm.public.Incident.where({
        id: incidentId,
        workspaceId,
      }).first();
      if (!incident) {
        return { events: [], attempts: [] };
      }

      const links = await db.orm.public.IncidentEvent.where({ incidentId }).all();
      const linkedEventIds = new Set(links.map((l) => l.eventId));

      const eventRows = (
        await db.orm.public.WebhookEvent.where({ workspaceId }).all()
      )
        .filter((row) => linkedEventIds.has(row.id))
        .sort(
          (a, b) =>
            b.firstReceivedAt.getTime() - a.firstReceivedAt.getTime() ||
            a.id.localeCompare(b.id),
        )
        .slice(0, limit);

      const keptIds = new Set(eventRows.map((e) => e.id));
      const attemptRows = (
        await db.orm.public.DeliveryAttempt.where({ workspaceId }).all()
      )
        .filter((row) => row.eventId !== null && keptIds.has(row.eventId))
        .sort(
          (a, b) =>
            a.receivedAt.getTime() - b.receivedAt.getTime() || a.id.localeCompare(b.id),
        );

      const events: WebhookEvent[] = eventRows.map((row) => ({
        id: row.id,
        integrationId: row.integrationId,
        externalEventId: row.externalEventId,
        eventType: row.eventType,
        occurredAt: row.occurredAt,
        firstReceivedAt: row.firstReceivedAt,
        traceId: row.traceId,
        payloadDigest: row.payloadDigest,
        redactedPayloadJson: row.redactedPayloadJson,
        processingState: row.processingState,
      }));

      const attempts: DeliveryAttempt[] = attemptRows.map((row) => ({
        id: row.id,
        eventId: row.eventId,
        integrationId: row.integrationId,
        receivedAt: row.receivedAt,
        httpStatus: row.httpStatus,
        durationMs: row.durationMs,
        senderWaitMs: row.senderWaitMs,
        verificationState: row.verificationState,
        handlerState: row.handlerState,
        errorCode: row.errorCode,
        correlationId: row.correlationId,
      }));

      return { events, attempts };
    },

    async getEvidenceByIds(workspaceId, evidenceIds): Promise<readonly Evidence[]> {
      const wanted = new Set(evidenceIds);
      const rows = (await db.orm.public.Evidence.where({ workspaceId }).all()).filter((row) =>
        wanted.has(row.id),
      );
      return rows.map((row) => ({
        id: row.id,
        sourceKind: row.sourceKind,
        sourceRecordId: row.sourceRecordId,
        summary: row.summary,
        sha256Digest: row.sha256Digest,
        trustTier: row.trustTier,
        recordedAt: row.recordedAt,
        structuredDataJson: row.structuredDataJson,
      }));
    },

    async searchRelatedEvents(workspaceId, query): Promise<readonly WebhookEvent[]> {
      const rows = (await db.orm.public.WebhookEvent.where({ workspaceId }).all())
        .filter((row) => {
          if (query.integrationId && row.integrationId !== query.integrationId) return false;
          if (query.traceId && row.traceId !== query.traceId) return false;
          if (query.from && row.firstReceivedAt < query.from) return false;
          if (query.to && row.firstReceivedAt > query.to) return false;
          return true;
        })
        .sort(
          (a, b) =>
            b.firstReceivedAt.getTime() - a.firstReceivedAt.getTime() ||
            a.id.localeCompare(b.id),
        )
        .slice(0, query.limit);

      return rows.map((row) => ({
        id: row.id,
        integrationId: row.integrationId,
        externalEventId: row.externalEventId,
        eventType: row.eventType,
        occurredAt: row.occurredAt,
        firstReceivedAt: row.firstReceivedAt,
        traceId: row.traceId,
        payloadDigest: row.payloadDigest,
        redactedPayloadJson: row.redactedPayloadJson,
        processingState: row.processingState,
      }));
    },

    async getIntegrationConfigSummary(
      workspaceId,
      integrationId,
    ): Promise<IntegrationConfigSummaryView | null> {
      const integration = await db.orm.public.Integration.where({
        id: integrationId,
        workspaceId,
      }).first();
      if (!integration) return null;

      const keys = await db.orm.public.IngestKey.where({
        workspaceId,
        integrationId,
      }).all();
      const activeIngestKeyCount = keys.filter((k) => k.revokedAt === null).length;

      return {
        id: integration.id,
        workspaceId: integration.workspaceId,
        environment: integration.environment,
        endpoint: integration.endpoint,
        hasSigningSecret: integration.signingSecret.trim().length > 0,
        activeIngestKeyCount,
      };
    },

    async listRuleFindings(workspaceId, incidentId): Promise<readonly FindingRecordView[]> {
      const findingRows = await db.orm.public.Finding.where({
        workspaceId,
        incidentId,
      }).all();
      if (findingRows.length === 0) return [];

      const findingIds = new Set(findingRows.map((f) => f.id));
      const links = (await db.orm.public.FindingEvidence.all()).filter((l) =>
        findingIds.has(l.findingId),
      );

      return findingRows.map((f) => ({
        id: f.id,
        eventId: f.eventId,
        ruleId: f.ruleId,
        ruleVersion: f.ruleVersion,
        failureClass: f.failureClass,
        explanation: f.explanation,
        certainty: f.certainty,
        evidenceIds: links.filter((l) => l.findingId === f.id).map((l) => l.evidenceId),
      }));
    },
  };
}
