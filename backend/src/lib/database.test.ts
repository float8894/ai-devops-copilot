import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { query, db } from './database.js';
import type { JobRow } from '../models/job.js';

describe('Database - PostgreSQL integration', () => {
  // Clean up test data before and after
  beforeAll(async () => {
    await db.query("DELETE FROM jobs WHERE name LIKE 'vitest-%'");
  });

  afterAll(async () => {
    await db.query("DELETE FROM jobs WHERE name LIKE 'vitest-%'");
    await db.end();
  });

  describe('query helper', () => {
    it('should return typed rows from parameterized query', async () => {
      // Insert test data
      await db.query(
        `INSERT INTO jobs (name, status, error_message, created_at) VALUES
         ('vitest-job-1', 'failed', 'Connection timeout', NOW() - INTERVAL '1 hour'),
         ('vitest-job-2', 'failed', 'Out of memory', NOW() - INTERVAL '2 hours'),
         ('vitest-job-3', 'completed', NULL, NOW() - INTERVAL '30 minutes')`,
      );

      const rows = await query<JobRow>(
        `SELECT id, name, status, error_message, created_at
         FROM jobs
         WHERE status = $1 AND name LIKE 'vitest-%'
         ORDER BY created_at DESC`,
        ['failed'],
      );

      expect(rows.length).toBe(2);
      expect(rows[0]?.name).toBe('vitest-job-1');
      expect(rows[0]?.status).toBe('failed');
      expect(rows[0]?.error_message).toBe('Connection timeout');
      expect(rows[1]?.name).toBe('vitest-job-2');
    });

    it('should handle INTERVAL cast correctly in time range queries', async () => {
      const rows = await query<JobRow>(
        `SELECT id, name, status, created_at
         FROM jobs
         WHERE status = 'failed'
           AND created_at > NOW() - $1::interval
           AND name LIKE 'vitest-%'
         ORDER BY created_at DESC
         LIMIT 10`,
        ['24 hours'],
      );

      expect(rows.length).toBeGreaterThanOrEqual(2);
      expect(rows.every((r) => r.status === 'failed')).toBe(true);
    });

    it('should return empty array when no results match', async () => {
      const rows = await query<JobRow>(
        `SELECT * FROM jobs WHERE name = $1`,
        ['nonexistent-job-xyz'],
      );

      expect(rows).toEqual([]);
    });
  });

  describe('error grouping pattern (for MCP tool)', () => {
    it('should correctly group errors by message', async () => {
      // Insert duplicate error patterns
      await db.query(
        `INSERT INTO jobs (name, status, error_message, created_at) VALUES
         ('vitest-group-1', 'failed', 'Database connection lost', NOW()),
         ('vitest-group-2', 'failed', 'Database connection lost', NOW()),
         ('vitest-group-3', 'failed', 'Timeout after 30s', NOW())`,
      );

      const rows = await query<JobRow>(
        `SELECT error_message FROM jobs WHERE name LIKE 'vitest-group-%'`,
      );

      const errorPatterns: Record<string, number> = {};
      for (const row of rows) {
        const key = row.error_message ?? 'Unknown error';
        errorPatterns[key] = (errorPatterns[key] ?? 0) + 1;
      }

      expect(errorPatterns['Database connection lost']).toBe(2);
      expect(errorPatterns['Timeout after 30s']).toBe(1);
    });
  });
});
