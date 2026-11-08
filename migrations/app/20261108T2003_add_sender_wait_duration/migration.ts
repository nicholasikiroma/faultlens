#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/4c9acb24de3aae5df7013120ee427d662d4e1c0da68bb0a18823f31d0d81535a/contract';
import endContract from '../../snapshots/4c9acb24de3aae5df7013120ee427d662d4e1c0da68bb0a18823f31d0d81535a/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/b34168499028a08c57d0b23c5456220acb24cb7344d1435037262f7219a8bc5e/contract';
import startContract from '../../snapshots/b34168499028a08c57d0b23c5456220acb24cb7344d1435037262f7219a8bc5e/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'delivery_attempts',
        column: col('sender_wait_ms', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
