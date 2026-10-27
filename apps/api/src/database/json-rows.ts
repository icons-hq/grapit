import { getTableColumns, sql, type InferSelectModel, type SQL } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';

/**
 * A correlated, ordered collection in the parent's SELECT snapshot. Decode
 * the JSON through the table's column mappings: timestamps must still be Date
 * objects, enums/JSON/numbers must have the same values as an ordinary select.
 * SQL identifiers and predicates remain parameterized Drizzle expressions.
 */
export function jsonRows<T extends PgTable>(
  table: T,
  predicate: SQL,
  orderBy?: SQL,
): SQL<InferSelectModel<T>[]> {
  const columns = Object.entries(getTableColumns(table));
  return sql`coalesce((
    select json_agg(${table}${orderBy ? sql` order by ${orderBy}` : sql``})
    from ${table} where ${predicate}
  ), '[]'::json)`.mapWith((rows: Record<string, unknown>[]) => rows.map((row) =>
    Object.fromEntries(columns.map(([key, column]) => {
      const value = row[column.name];
      return [key, value === null || value === undefined ? value : column.mapFromDriverValue(value)];
    })) as InferSelectModel<T>,
  ));
}
