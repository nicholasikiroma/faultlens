#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/4a8360364ef68361027912468ca5b834e3021eb93e348ba39934c388bb01721b/contract';
import endContract from '../../snapshots/4a8360364ef68361027912468ca5b834e3021eb93e348ba39934c388bb01721b/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/550abe7d3161095409a9ec24dcdb674c2ab6c031e8fc4abe55c121c65915a1f6/contract';
import startContract from '../../snapshots/550abe7d3161095409a9ec24dcdb674c2ab6c031e8fc4abe55c121c65915a1f6/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, primaryKey } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'ingest_keys',
        columns: [
          col('created_at', 'timestamp(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamp-date@1', typeParams: { precision: 3 } },
          }),
          col('environment', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('integration_id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('key_hash', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('revoked_at', 'timestamp(3)', {
            codecRef: { codecId: 'pg/timestamp-date@1', typeParams: { precision: 3 } },
          }),
          col('workspace_id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createIndex({
        schema: 'public',
        table: 'ingest_keys',
        index: 'ingest_keys_key_hash_key',
        columns: ['key_hash'],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'ingest_keys',
        index: 'ingest_keys_workspace_id_integration_id_idx',
        columns: ['workspace_id', 'integration_id'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'ingest_keys',
        foreignKey: {
          name: 'ingest_keys_integration_id_fkey',
          columns: ['integration_id'],
          references: { schema: 'public', table: 'integrations', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
