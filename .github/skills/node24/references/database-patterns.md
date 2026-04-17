# Database Patterns — PostgreSQL + Node 24

## Connection Pool Setup

```typescript
// src/lib/database.ts
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

// Typed query helper — always use this, never db.query directly in business logic
export async function query<T extends pg.QueryResultRow>(
  sql: string,
  params?: unknown[]
): Promise<T[]> {
  try {
    const result = await db.query<T>(sql, params);
    return result.rows;
  } catch (err) {
    throw new DatabaseError(`Query failed: ${sql.slice(0, 80)}`, err);
  }
}

// Transaction helper
export async function withTransaction<T>(
  fn: (client: pg.PoolClient) => Promise<T>
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
```

## Query Patterns

```typescript
// ✅ Always parameterized — never string interpolation
// Note: INTERVAL requires ::interval cast when parameterized in pg
const jobs = await query<JobRow>(
  `SELECT id, name, status, error_message, created_at
   FROM jobs
   WHERE status = $1 AND created_at > NOW() - $2::interval
   ORDER BY created_at DESC LIMIT $3`,
  ['failed', '24 hours', 20]
);

// ❌ Never do this — SQL injection risk
const jobs = await db.query(`SELECT * FROM jobs WHERE status = '${status}'`);

// ✅ Transaction for multi-step operations
await withTransaction(async (client) => {
  await client.query('UPDATE jobs SET status = $1 WHERE id = $2', ['retrying', jobId]);
  await client.query('INSERT INTO job_attempts (job_id, attempt_at) VALUES ($1, NOW())', [jobId]);
});
```

## Row Types

```typescript
// src/models/job.ts
export interface JobRow {
  id: string;
  name: string;
  status: 'pending' | 'running' | 'failed' | 'completed';
  error_message: string | null;
  created_at: Date;
  updated_at: Date;
}
```
