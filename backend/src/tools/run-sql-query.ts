import { db } from '../lib/database.js';
import { DatabaseError, ValidationError } from '../errors/index.js';

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;

// Matches: SELECT ... or WITH ... (CTEs that start a read query)
// Case-insensitive, ignores leading whitespace/comments
const READ_ONLY_RE = /^\s*(\/\*.*?\*\/\s*)*(--[^\n]*\n\s*)*(SELECT|WITH)\b/is;

export interface RunSqlQueryInput {
  sql: string;
  limit?: number | undefined;
}

export interface RunSqlQueryResult {
  rows: unknown[];
  count: number;
  truncated: boolean;
}

export async function runSqlQuery(
  input: RunSqlQueryInput,
): Promise<RunSqlQueryResult> {
  const { sql } = input;
  const limit = Math.min(input.limit ?? DEFAULT_LIMIT, MAX_LIMIT);

  // Security layer 1: only allow SELECT / WITH queries
  if (!READ_ONLY_RE.test(sql)) {
    throw new ValidationError(
      'Only SELECT queries are allowed. Detected a non-read statement.',
    );
  }

  // Security layer 2: run inside a read-only transaction
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET TRANSACTION READ ONLY');

    // Append LIMIT if not already present (case-insensitive)
    const hasLimit = /\bLIMIT\b/i.test(sql);
    const finalSql = hasLimit ? sql : `${sql.trimEnd()} LIMIT $1`;
    const params = hasLimit ? [] : [limit];

    let result;
    try {
      result = await client.query(finalSql, params);
    } catch (err) {
      throw new DatabaseError('SQL query execution failed', err);
    }

    await client.query('COMMIT');

    const rows = result.rows as unknown[];
    const truncated = !hasLimit && rows.length === limit;

    return { rows, count: rows.length, truncated };
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // ignore rollback error
    }
    throw err;
  } finally {
    client.release();
  }
}
