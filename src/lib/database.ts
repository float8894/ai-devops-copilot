import pg from 'pg';
import { env } from '../config/env.js';
import { logger } from './logger.js';
import { DatabaseError } from '../errors/index.js';

const { Pool } = pg;

export const db = new Pool({
  connectionString: env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

db.on('error', (err) => {
  logger.error({ err }, 'PostgreSQL pool error');
});

export async function query<T extends pg.QueryResultRow>(
  sql: string,
  params?: unknown[],
): Promise<T[]> {
  try {
    const result = await db.query<T>(sql, params);
    return result.rows;
  } catch (err) {
    throw new DatabaseError(`Query failed: ${sql.slice(0, 80)}`, err);
  }
}

export async function withTransaction<T>(
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
