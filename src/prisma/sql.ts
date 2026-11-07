import { param } from '@prisma/orm-family-sql/relational-core/expression';

export function sqlText(value: string | null) {
  return value === null ? param(null, { codecId: 'pg/text@1' }) : value;
}

export function sqlTimestamp(value: Date | null) {
  return value === null ? param(null, { codecId: 'pg/timestamp-date@1' }) : value.toISOString();
}
