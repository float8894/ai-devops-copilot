import { query } from '../lib/database.js';
import { DatabaseError } from '../errors/index.js';

export interface ColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
  isPrimaryKey: boolean;
  isForeignKey: boolean;
  references?: { table: string; column: string };
}

export interface TableSchema {
  name: string;
  columns: ColumnInfo[];
}

export interface DbSchemaResult {
  tables: TableSchema[];
  tableCount: number;
}

interface ColumnRow {
  table_name: string;
  column_name: string;
  data_type: string;
  is_nullable: string;
  is_pk: boolean;
}

interface FkRow {
  table_name: string;
  column_name: string;
  ref_table: string;
  ref_column: string;
}

export async function getDbSchema(): Promise<DbSchemaResult> {
  try {
    const [columnRows, fkRows] = await Promise.all([
      query<ColumnRow>(
        `SELECT
           c.table_name,
           c.column_name,
           c.data_type,
           c.is_nullable,
           CASE WHEN pk.column_name IS NOT NULL THEN true ELSE false END AS is_pk
         FROM information_schema.columns c
         LEFT JOIN (
           SELECT ku.table_name, ku.column_name
           FROM information_schema.table_constraints tc
           JOIN information_schema.key_column_usage ku
             ON tc.constraint_name = ku.constraint_name
             AND tc.table_schema = ku.table_schema
           WHERE tc.constraint_type = 'PRIMARY KEY'
             AND tc.table_schema = 'public'
         ) pk ON pk.table_name = c.table_name AND pk.column_name = c.column_name
         WHERE c.table_schema = 'public'
         ORDER BY c.table_name, c.ordinal_position`,
      ),
      query<FkRow>(
        `SELECT
           kcu.table_name,
           kcu.column_name,
           ccu.table_name  AS ref_table,
           ccu.column_name AS ref_column
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu
           ON tc.constraint_name = kcu.constraint_name
           AND tc.table_schema = kcu.table_schema
         JOIN information_schema.constraint_column_usage ccu
           ON ccu.constraint_name = tc.constraint_name
           AND ccu.table_schema = tc.table_schema
         WHERE tc.constraint_type = 'FOREIGN KEY'
           AND tc.table_schema = 'public'`,
      ),
    ]);

    // Build FK lookup: "table.column" → { table, column }
    const fkMap = new Map<string, { table: string; column: string }>();
    for (const fk of fkRows) {
      fkMap.set(`${fk.table_name}.${fk.column_name}`, {
        table: fk.ref_table,
        column: fk.ref_column,
      });
    }

    // Group columns by table
    const tableMap = new Map<string, ColumnInfo[]>();
    for (const row of columnRows) {
      const key = `${row.table_name}.${row.column_name}`;
      const fk = fkMap.get(key);
      const col: ColumnInfo = {
        name: row.column_name,
        type: row.data_type,
        nullable: row.is_nullable === 'YES',
        isPrimaryKey: row.is_pk,
        isForeignKey: fk !== undefined,
        ...(fk !== undefined ? { references: fk } : {}),
      };
      const existing = tableMap.get(row.table_name);
      if (existing !== undefined) {
        existing.push(col);
      } else {
        tableMap.set(row.table_name, [col]);
      }
    }

    const tables: TableSchema[] = Array.from(tableMap.entries()).map(
      ([name, columns]) => ({ name, columns }),
    );

    return { tables, tableCount: tables.length };
  } catch (err) {
    if (err instanceof DatabaseError) throw err;
    throw new DatabaseError('Failed to retrieve database schema', err);
  }
}
