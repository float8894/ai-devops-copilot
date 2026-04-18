import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock database before importing the tool
vi.mock('../lib/database.js', () => ({
  db: {
    connect: vi.fn(),
  },
}));

vi.mock('../lib/logger.js', () => ({
  createLogger: () => ({ info: vi.fn(), error: vi.fn() }),
}));

import { db } from '../lib/database.js';
import { runSqlQuery } from './run-sql-query.js';
import { ValidationError, DatabaseError } from '../errors/index.js';

function makeMockClient(rows: unknown[] = []) {
  return {
    query: vi.fn().mockImplementation(async (sql: string) => {
      if (
        sql === 'BEGIN' ||
        sql === 'COMMIT' ||
        sql === 'ROLLBACK' ||
        sql === 'SET TRANSACTION READ ONLY'
      ) {
        return { rows: [] };
      }
      return { rows };
    }),
    release: vi.fn(),
  };
}

const mockDb = vi.mocked(db);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('runSqlQuery — security validation', () => {
  it('accepts a plain SELECT query', async () => {
    const client = makeMockClient([{ id: 1 }]);
    mockDb.connect.mockResolvedValue(client as never);

    const result = await runSqlQuery({ sql: 'SELECT * FROM jobs' });

    expect(result.rows).toHaveLength(1);
    expect(result.count).toBe(1);
  });

  it('accepts a WITH (CTE) query', async () => {
    const client = makeMockClient([{ total: 5 }]);
    mockDb.connect.mockResolvedValue(client as never);

    const result = await runSqlQuery({
      sql: 'WITH cte AS (SELECT 1 AS n) SELECT * FROM cte',
    });

    expect(result.rows).toHaveLength(1);
  });

  it('accepts SELECT with leading whitespace', async () => {
    const client = makeMockClient([]);
    mockDb.connect.mockResolvedValue(client as never);

    await expect(runSqlQuery({ sql: '   SELECT 1' })).resolves.toBeDefined();
  });

  it('rejects INSERT', async () => {
    await expect(
      runSqlQuery({ sql: "INSERT INTO jobs (name) VALUES ('x')" }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects UPDATE', async () => {
    await expect(
      runSqlQuery({ sql: "UPDATE jobs SET status = 'failed'" }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects DELETE', async () => {
    await expect(
      runSqlQuery({ sql: 'DELETE FROM jobs' }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects DROP', async () => {
    await expect(
      runSqlQuery({ sql: 'DROP TABLE jobs' }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('runSqlQuery — limit handling', () => {
  it('appends LIMIT $1 when no LIMIT in query', async () => {
    const client = makeMockClient([]);
    mockDb.connect.mockResolvedValue(client as never);

    await runSqlQuery({ sql: 'SELECT * FROM jobs', limit: 10 });

    const executedCall = client.query.mock.calls.find(
      ([sql]) =>
        typeof sql === 'string' &&
        /SELECT/i.test(sql as string) &&
        /LIMIT/i.test(sql as string),
    );
    expect(executedCall).toBeDefined();
  });

  it('does not double-append LIMIT when already present', async () => {
    const client = makeMockClient([]);
    mockDb.connect.mockResolvedValue(client as never);

    await runSqlQuery({ sql: 'SELECT * FROM jobs LIMIT 5' });

    // The SQL passed to query should not have two LIMIT clauses
    const dataCall = client.query.mock.calls.find(
      ([sql]) => typeof sql === 'string' && /SELECT/i.test(sql as string),
    );
    const callSql = dataCall?.[0] as string;
    const limitCount = (callSql.match(/LIMIT/gi) ?? []).length;
    expect(limitCount).toBe(1);
  });

  it('caps limit at 200', async () => {
    const client = makeMockClient([]);
    mockDb.connect.mockResolvedValue(client as never);

    await runSqlQuery({ sql: 'SELECT * FROM jobs', limit: 999 });

    const dataCall = client.query.mock.calls.find(
      ([, params]) => Array.isArray(params) && (params as unknown[]).length > 0,
    );
    const passedLimit = (dataCall?.[1] as number[])?.[0];
    expect(passedLimit).toBeLessThanOrEqual(200);
  });

  it('sets truncated=true when rows.length equals limit', async () => {
    const rows = Array.from({ length: 50 }, (_, i) => ({ id: i }));
    const client = makeMockClient(rows);
    mockDb.connect.mockResolvedValue(client as never);

    const result = await runSqlQuery({ sql: 'SELECT * FROM jobs', limit: 50 });

    expect(result.truncated).toBe(true);
  });

  it('sets truncated=false when fewer rows than limit', async () => {
    const client = makeMockClient([{ id: 1 }, { id: 2 }]);
    mockDb.connect.mockResolvedValue(client as never);

    const result = await runSqlQuery({ sql: 'SELECT * FROM jobs', limit: 50 });

    expect(result.truncated).toBe(false);
  });
});

describe('runSqlQuery — read-only transaction', () => {
  it('always issues SET TRANSACTION READ ONLY', async () => {
    const client = makeMockClient([]);
    mockDb.connect.mockResolvedValue(client as never);

    await runSqlQuery({ sql: 'SELECT 1' });

    expect(client.query).toHaveBeenCalledWith('SET TRANSACTION READ ONLY');
  });

  it('always issues BEGIN and COMMIT', async () => {
    const client = makeMockClient([]);
    mockDb.connect.mockResolvedValue(client as never);

    await runSqlQuery({ sql: 'SELECT 1' });

    expect(client.query).toHaveBeenCalledWith('BEGIN');
    expect(client.query).toHaveBeenCalledWith('COMMIT');
  });

  it('always releases the client', async () => {
    const client = makeMockClient([]);
    mockDb.connect.mockResolvedValue(client as never);

    await runSqlQuery({ sql: 'SELECT 1' });

    expect(client.release).toHaveBeenCalledOnce();
  });
});

describe('runSqlQuery — error handling', () => {
  it('wraps pg errors in DatabaseError', async () => {
    const client = makeMockClient([]);
    client.query.mockImplementation(async (sql: string) => {
      if (sql === 'BEGIN' || sql === 'SET TRANSACTION READ ONLY')
        return { rows: [] };
      if (/SELECT/i.test(sql)) throw new Error('relation does not exist');
      return { rows: [] };
    });
    mockDb.connect.mockResolvedValue(client as never);

    await expect(
      runSqlQuery({ sql: 'SELECT * FROM nonexistent' }),
    ).rejects.toBeInstanceOf(DatabaseError);
  });

  it('releases client even after error', async () => {
    const client = makeMockClient([]);
    client.query.mockImplementation(async (sql: string) => {
      if (sql === 'BEGIN' || sql === 'SET TRANSACTION READ ONLY')
        return { rows: [] };
      if (/SELECT/i.test(sql)) throw new Error('fail');
      return { rows: [] };
    });
    mockDb.connect.mockResolvedValue(client as never);

    await expect(runSqlQuery({ sql: 'SELECT 1' })).rejects.toThrow();
    expect(client.release).toHaveBeenCalledOnce();
  });
});
