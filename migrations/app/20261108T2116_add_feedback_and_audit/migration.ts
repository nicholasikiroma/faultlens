#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/4c9acb24de3aae5df7013120ee427d662d4e1c0da68bb0a18823f31d0d81535a/contract';
import startContract from '../../snapshots/4c9acb24de3aae5df7013120ee427d662d4e1c0da68bb0a18823f31d0d81535a/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/550abe7d3161095409a9ec24dcdb674c2ab6c031e8fc4abe55c121c65915a1f6/contract';
import endContract from '../../snapshots/550abe7d3161095409a9ec24dcdb674c2ab6c031e8fc4abe55c121c65915a1f6/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, primaryKey } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createNativeEnumType({
        schema: 'public',
        typeName: 'AuditAction',
        members: ['INCIDENT_STATUS_CHANGED', 'FINDING_RATED'],
      }),
      this.createNativeEnumType({
        schema: 'public',
        typeName: 'AuditObjectType',
        members: ['INCIDENT', 'FINDING'],
      }),
      this.createNativeEnumType({
        schema: 'public',
        typeName: 'FeedbackRating',
        members: ['USEFUL', 'INCORRECT'],
      }),
      this.createTable({
        schema: 'public',
        table: 'audit_events',
        columns: [
          col('action', '"AuditAction"', {
            notNull: true,
            codecRef: { codecId: 'pg/enum@1', typeParams: { typeName: 'AuditAction' } },
          }),
          col('actor', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('new_state', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('object_id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('object_type', '"AuditObjectType"', {
            notNull: true,
            codecRef: { codecId: 'pg/enum@1', typeParams: { typeName: 'AuditObjectType' } },
          }),
          col('old_state', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('timestamp', 'timestamp(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamp-date@1', typeParams: { precision: 3 } },
          }),
          col('workspace_id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'feedback',
        columns: [
          col('actor', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('created_at', 'timestamp(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamp-date@1', typeParams: { precision: 3 } },
          }),
          col('finding_id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('note', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('rating', '"FeedbackRating"', {
            notNull: true,
            codecRef: { codecId: 'pg/enum@1', typeParams: { typeName: 'FeedbackRating' } },
          }),
          col('workspace_id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createIndex({
        schema: 'public',
        table: 'audit_events',
        index: 'audit_events_workspace_id_object_type_object_id_timestamp_idx',
        columns: ['workspace_id', 'object_type', 'object_id', 'timestamp'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'feedback',
        index: 'feedback_finding_id_actor_key',
        columns: ['finding_id', 'actor'],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'feedback',
        index: 'feedback_workspace_id_finding_id_idx',
        columns: ['workspace_id', 'finding_id'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'feedback',
        foreignKey: {
          name: 'feedback_finding_id_fkey',
          columns: ['finding_id'],
          references: { schema: 'public', table: 'findings', columns: ['id'] },
          onDelete: 'restrict',
          onUpdate: 'cascade',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
