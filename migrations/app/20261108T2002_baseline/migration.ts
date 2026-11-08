#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/b34168499028a08c57d0b23c5456220acb24cb7344d1435037262f7219a8bc5e/contract';
import endContract from '../../snapshots/b34168499028a08c57d0b23c5456220acb24cb7344d1435037262f7219a8bc5e/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, lit, primaryKey } from '@prisma/orm-postgres/migration';

export default class M extends Migration<never, End> {
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createSchema({ schema: 'public' }),
      this.createNativeEnumType({
        schema: 'public',
        typeName: 'FailureClass',
        members: [
          'AUTH_FAILURE',
          'RATE_LIMIT',
          'NETWORK_TIMEOUT',
          'UPSTREAM_5XX',
          'SCHEMA_MISMATCH',
          'INVALID_SIGNATURE',
          'DUPLICATE_DELIVERY',
          'OUT_OF_ORDER',
          'UNKNOWN',
        ],
      }),
      this.createNativeEnumType({
        schema: 'public',
        typeName: 'HandlerState',
        members: ['PENDING', 'PROCESSED', 'FAILED'],
      }),
      this.createNativeEnumType({
        schema: 'public',
        typeName: 'IncidentStatus',
        members: ['OPEN', 'INVESTIGATING', 'RESOLVED', 'ARCHIVED'],
      }),
      this.createNativeEnumType({
        schema: 'public',
        typeName: 'ProcessingState',
        members: ['RECEIVED', 'QUEUED', 'PROCESSED', 'FAILED'],
      }),
      this.createNativeEnumType({
        schema: 'public',
        typeName: 'RunMode',
        members: ['RULES', 'AI_ASSISTED'],
      }),
      this.createNativeEnumType({
        schema: 'public',
        typeName: 'RunState',
        members: [
          'NOT_STARTED',
          'QUEUED',
          'RUNNING',
          'NEEDS_REVIEW',
          'COMPLETED',
          'FAILED',
          'CANCELLED',
        ],
      }),
      this.createNativeEnumType({
        schema: 'public',
        typeName: 'SourceKind',
        members: ['DELIVERY_ATTEMPT', 'WEBHOOK_EVENT', 'FIXTURE'],
      }),
      this.createNativeEnumType({
        schema: 'public',
        typeName: 'TrustTier',
        members: ['A', 'B', 'C'],
      }),
      this.createNativeEnumType({
        schema: 'public',
        typeName: 'VerificationState',
        members: ['RECEIVED', 'VERIFIED', 'REJECTED'],
      }),
      this.createTable({
        schema: 'public',
        table: 'delivery_attempts',
        columns: [
          col('correlation_id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('duration_ms', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('error_code', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('event_id', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('handler_state', '"HandlerState"', {
            notNull: true,
            codecRef: { codecId: 'pg/enum@1', typeParams: { typeName: 'HandlerState' } },
          }),
          col('http_status', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('integration_id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('received_at', 'timestamp(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamp-date@1', typeParams: { precision: 3 } },
          }),
          col('verification_state', '"VerificationState"', {
            notNull: true,
            codecRef: { codecId: 'pg/enum@1', typeParams: { typeName: 'VerificationState' } },
          }),
          col('workspace_id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'evidence',
        columns: [
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('sha256_digest', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('source_kind', '"SourceKind"', {
            notNull: true,
            codecRef: { codecId: 'pg/enum@1', typeParams: { typeName: 'SourceKind' } },
          }),
          col('source_record_id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('summary', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('trust_tier', '"TrustTier"', {
            notNull: true,
            codecRef: { codecId: 'pg/enum@1', typeParams: { typeName: 'TrustTier' } },
          }),
          col('workspace_id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'finding_evidence',
        columns: [
          col('evidence_id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('finding_id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['finding_id', 'evidence_id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'findings',
        columns: [
          col('certainty', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('event_id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('explanation', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('failure_class', '"FailureClass"', {
            notNull: true,
            codecRef: { codecId: 'pg/enum@1', typeParams: { typeName: 'FailureClass' } },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('incident_id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('rule_id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('rule_version', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('workspace_id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'incident_events',
        columns: [
          col('event_id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('incident_id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('linked_at', 'timestamp(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamp-date@1', typeParams: { precision: 3 } },
          }),
        ],
        constraints: [primaryKey(['incident_id', 'event_id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'incidents',
        columns: [
          col('endpoint', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('environment', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('event_count', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('failure_class', '"FailureClass"', {
            notNull: true,
            codecRef: { codecId: 'pg/enum@1', typeParams: { typeName: 'FailureClass' } },
          }),
          col('fingerprint', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('first_seen_at', 'timestamp(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamp-date@1', typeParams: { precision: 3 } },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('integration_id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('last_seen_at', 'timestamp(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamp-date@1', typeParams: { precision: 3 } },
          }),
          col('rule_version', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('status', '"IncidentStatus"', {
            notNull: true,
            codecRef: { codecId: 'pg/enum@1', typeParams: { typeName: 'IncidentStatus' } },
          }),
          col('workspace_id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'integrations',
        columns: [
          col('endpoint', 'text', {
            notNull: true,
            default: lit('/'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('endpoint_token', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('environment', 'text', {
            notNull: true,
            default: lit('local'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('signing_secret', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('workspace_id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'investigation_runs',
        columns: [
          col('ended_at', 'timestamp(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamp-date@1', typeParams: { precision: 3 } },
          }),
          col('event_id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('incident_id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('mode', '"RunMode"', {
            notNull: true,
            codecRef: { codecId: 'pg/enum@1', typeParams: { typeName: 'RunMode' } },
          }),
          col('ruleset_version', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('started_at', 'timestamp(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamp-date@1', typeParams: { precision: 3 } },
          }),
          col('state', '"RunState"', {
            notNull: true,
            codecRef: { codecId: 'pg/enum@1', typeParams: { typeName: 'RunState' } },
          }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'outbox',
        columns: [
          col('attempt_id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('enqueued_at', 'timestamp(3)', {
            codecRef: { codecId: 'pg/timestamp-date@1', typeParams: { precision: 3 } },
          }),
          col('event_id', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'webhook_events',
        columns: [
          col('event_type', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('external_event_id', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('first_received_at', 'timestamp(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamp-date@1', typeParams: { precision: 3 } },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('integration_id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('occurred_at', 'timestamp(3)', {
            codecRef: { codecId: 'pg/timestamp-date@1', typeParams: { precision: 3 } },
          }),
          col('payload_digest', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('processing_state', '"ProcessingState"', {
            notNull: true,
            codecRef: { codecId: 'pg/enum@1', typeParams: { typeName: 'ProcessingState' } },
          }),
          col('redacted_payload_json', 'jsonb', { codecRef: { codecId: 'pg/jsonb@1' } }),
          col('trace_id', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('workspace_id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createIndex({
        schema: 'public',
        table: 'findings',
        index: 'findings_event_id_rule_id_rule_version_key',
        columns: ['event_id', 'rule_id', 'rule_version'],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'incidents',
        index: 'incidents_workspace_id_fingerprint_rule_version_key',
        columns: ['workspace_id', 'fingerprint', 'rule_version'],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'integrations',
        index: 'integrations_endpoint_token_key',
        columns: ['endpoint_token'],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'investigation_runs',
        index: 'investigation_runs_event_id_incident_id_mode_ruleset_versio_key',
        columns: ['event_id', 'incident_id', 'mode', 'ruleset_version'],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'webhook_events',
        index: 'webhook_events_integration_id_external_event_id_key',
        columns: ['integration_id', 'external_event_id'],
        extras: { unique: true },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'delivery_attempts',
        foreignKey: {
          name: 'delivery_attempts_event_id_fkey',
          columns: ['event_id'],
          references: { schema: 'public', table: 'webhook_events', columns: ['id'] },
          onDelete: 'restrict',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'delivery_attempts',
        foreignKey: {
          name: 'delivery_attempts_integration_id_fkey',
          columns: ['integration_id'],
          references: { schema: 'public', table: 'integrations', columns: ['id'] },
          onDelete: 'restrict',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'finding_evidence',
        foreignKey: {
          name: 'finding_evidence_finding_id_fkey',
          columns: ['finding_id'],
          references: { schema: 'public', table: 'findings', columns: ['id'] },
          onDelete: 'restrict',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'finding_evidence',
        foreignKey: {
          name: 'finding_evidence_evidence_id_fkey',
          columns: ['evidence_id'],
          references: { schema: 'public', table: 'evidence', columns: ['id'] },
          onDelete: 'restrict',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'findings',
        foreignKey: {
          name: 'findings_incident_id_fkey',
          columns: ['incident_id'],
          references: { schema: 'public', table: 'incidents', columns: ['id'] },
          onDelete: 'restrict',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'findings',
        foreignKey: {
          name: 'findings_event_id_fkey',
          columns: ['event_id'],
          references: { schema: 'public', table: 'webhook_events', columns: ['id'] },
          onDelete: 'restrict',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'incident_events',
        foreignKey: {
          name: 'incident_events_incident_id_fkey',
          columns: ['incident_id'],
          references: { schema: 'public', table: 'incidents', columns: ['id'] },
          onDelete: 'restrict',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'incident_events',
        foreignKey: {
          name: 'incident_events_event_id_fkey',
          columns: ['event_id'],
          references: { schema: 'public', table: 'webhook_events', columns: ['id'] },
          onDelete: 'restrict',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'investigation_runs',
        foreignKey: {
          name: 'investigation_runs_incident_id_fkey',
          columns: ['incident_id'],
          references: { schema: 'public', table: 'incidents', columns: ['id'] },
          onDelete: 'restrict',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'investigation_runs',
        foreignKey: {
          name: 'investigation_runs_event_id_fkey',
          columns: ['event_id'],
          references: { schema: 'public', table: 'webhook_events', columns: ['id'] },
          onDelete: 'restrict',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'outbox',
        foreignKey: {
          name: 'outbox_event_id_fkey',
          columns: ['event_id'],
          references: { schema: 'public', table: 'webhook_events', columns: ['id'] },
          onDelete: 'restrict',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'outbox',
        foreignKey: {
          name: 'outbox_attempt_id_fkey',
          columns: ['attempt_id'],
          references: { schema: 'public', table: 'delivery_attempts', columns: ['id'] },
          onDelete: 'restrict',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'webhook_events',
        foreignKey: {
          name: 'webhook_events_integration_id_fkey',
          columns: ['integration_id'],
          references: { schema: 'public', table: 'integrations', columns: ['id'] },
          onDelete: 'restrict',
          onUpdate: 'cascade',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
