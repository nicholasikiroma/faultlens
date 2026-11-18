import { db } from '#db';
import { config } from './config.ts';

export interface RetentionPurgeResult {
  readonly scrubbedPayloads: number;
  readonly prunedIncidents: number;
  readonly prunedEvents: number;
}

export async function purgeExpiredData(options?: {
  readonly now?: Date;
  readonly metadataDays?: number;
  readonly payloadDays?: number;
}): Promise<RetentionPurgeResult> {
  const now = options?.now ?? new Date();
  const payloadDays = options?.payloadDays ?? config.retentionPayloadDays;
  const metadataDays = options?.metadataDays ?? config.retentionMetadataDays;

  const payloadCutoff = new Date(now.getTime() - payloadDays * 86_400_000);
  const metadataCutoff = new Date(now.getTime() - metadataDays * 86_400_000);

  return db.transaction(async (tx) => {
    const scrubbedRows = await tx.query(
      tx.raw.sql`
        UPDATE webhook_events
        SET redacted_payload_json = NULL
        WHERE redacted_payload_json IS NOT NULL
          AND first_received_at < CAST(${payloadCutoff.toISOString()} AS timestamptz)
        RETURNING id
      `
        .returnsRow({ id: 'pg/text@1' })
        .build(),
    );

    const oldIncidents = await tx.query(
      tx.raw.sql`
        SELECT id FROM incidents
        WHERE status IN ('RESOLVED', 'ARCHIVED')
          AND last_seen_at < CAST(${metadataCutoff.toISOString()} AS timestamptz)
      `
        .returnsRow({ id: 'pg/text@1' })
        .build(),
    );

    let prunedIncidents = 0;
    for (const inc of oldIncidents) {
      await tx.execute(
        tx.raw.sql`
          DELETE FROM feedback
          WHERE finding_id IN (SELECT id FROM findings WHERE incident_id = ${inc.id})
        `
          .affectedCount()
          .build(),
      );
      await tx.execute(
        tx.raw.sql`
          DELETE FROM finding_evidence
          WHERE finding_id IN (SELECT id FROM findings WHERE incident_id = ${inc.id})
        `
          .affectedCount()
          .build(),
      );
      await tx.execute(
        tx.raw.sql`DELETE FROM findings WHERE incident_id = ${inc.id}`
          .affectedCount()
          .build(),
      );
      await tx.execute(
        tx.raw.sql`DELETE FROM incident_events WHERE incident_id = ${inc.id}`
          .affectedCount()
          .build(),
      );
      await tx.execute(
        tx.raw.sql`DELETE FROM investigation_runs WHERE incident_id = ${inc.id}`
          .affectedCount()
          .build(),
      );
      await tx.execute(
        tx.raw.sql`DELETE FROM incidents WHERE id = ${inc.id}`
          .affectedCount()
          .build(),
      );
      prunedIncidents += 1;
    }

    await tx.execute(
      tx.raw.sql`
        DELETE FROM outbox
        WHERE attempt_id IN (
          SELECT id FROM delivery_attempts
          WHERE received_at < CAST(${metadataCutoff.toISOString()} AS timestamptz)
            AND (
              event_id IS NULL
              OR event_id NOT IN (SELECT event_id FROM incident_events)
            )
        )
      `
        .affectedCount()
        .build(),
    );

    await tx.execute(
      tx.raw.sql`
        DELETE FROM delivery_attempts
        WHERE received_at < CAST(${metadataCutoff.toISOString()} AS timestamptz)
          AND (
            event_id IS NULL
            OR event_id NOT IN (SELECT event_id FROM incident_events)
          )
      `
        .affectedCount()
        .build(),
    );

    const prunedEventRows = await tx.query(
      tx.raw.sql`
        DELETE FROM webhook_events
        WHERE first_received_at < CAST(${metadataCutoff.toISOString()} AS timestamptz)
          AND id NOT IN (SELECT event_id FROM incident_events)
          AND id NOT IN (SELECT event_id FROM delivery_attempts WHERE event_id IS NOT NULL)
          AND id NOT IN (SELECT event_id FROM outbox WHERE event_id IS NOT NULL)
          AND id NOT IN (SELECT event_id FROM findings)
          AND id NOT IN (SELECT event_id FROM investigation_runs WHERE event_id IS NOT NULL)
        RETURNING id
      `
        .returnsRow({ id: 'pg/text@1' })
        .build(),
    );

    await tx.execute(
      tx.raw.sql`
        DELETE FROM evidence
        WHERE id NOT IN (SELECT evidence_id FROM finding_evidence)
          AND (recorded_at IS NULL OR recorded_at < CAST(${metadataCutoff.toISOString()} AS timestamptz))
          AND source_record_id NOT IN (SELECT id FROM webhook_events)
          AND source_record_id NOT IN (SELECT id FROM delivery_attempts)
      `
        .affectedCount()
        .build(),
    );

    return {
      scrubbedPayloads: scrubbedRows.length,
      prunedIncidents,
      prunedEvents: prunedEventRows.length,
    };
  });
}
