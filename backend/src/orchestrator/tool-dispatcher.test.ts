import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { GetAwsCostsResult } from '../tools/get-aws-costs.js';
import type { RedisStats } from '../models/job.js';
import type { DbSchemaResult } from '../tools/get-db-schema.js';
import type { RunSqlQueryResult } from '../tools/run-sql-query.js';

vi.mock('../tools/get-db-schema.js', () => ({
  getDbSchema: vi.fn(),
}));

vi.mock('../tools/run-sql-query.js', () => ({
  runSqlQuery: vi.fn(),
}));

vi.mock('../tools/get-redis-stats.js', () => ({
  getRedisStats: vi.fn(),
}));

vi.mock('../tools/get-aws-costs.js', () => ({
  getAwsCosts: vi.fn(),
}));

vi.mock('../lib/logger.js', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { dispatchTool } from './tool-dispatcher.js';
import { getDbSchema } from '../tools/get-db-schema.js';
import { runSqlQuery } from '../tools/run-sql-query.js';
import { getRedisStats } from '../tools/get-redis-stats.js';
import { getAwsCosts } from '../tools/get-aws-costs.js';
import { McpToolError } from '../errors/index.js';

const mockGetDbSchema = vi.mocked(getDbSchema);
const mockRunSqlQuery = vi.mocked(runSqlQuery);
const mockGetRedisStats = vi.mocked(getRedisStats);
const mockGetAwsCosts = vi.mocked(getAwsCosts);

const fakeCredentials = {
  accessKeyId: 'AKIA...',
  secretAccessKey: 'secret',
  sessionToken: 'token',
};

describe('dispatchTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ---------------------------------------------------------------------------
  // get_db_schema
  // ---------------------------------------------------------------------------

  it('routes "get_db_schema" to getDbSchema', async () => {
    const fakeResult: DbSchemaResult = { tables: [], tableCount: 0 };
    mockGetDbSchema.mockResolvedValue(fakeResult);

    const result = await dispatchTool('get_db_schema', {});

    expect(mockGetDbSchema).toHaveBeenCalledOnce();
    expect(result).toBe(fakeResult);
  });

  it('ignores any input passed to get_db_schema', async () => {
    mockGetDbSchema.mockResolvedValue({ tables: [], tableCount: 0 });

    await dispatchTool('get_db_schema', { unexpected: 'param' });

    expect(mockGetDbSchema).toHaveBeenCalledOnce();
  });

  // ---------------------------------------------------------------------------
  // run_sql_query
  // ---------------------------------------------------------------------------

  it('routes "run_sql_query" to runSqlQuery', async () => {
    const fakeResult: RunSqlQueryResult = {
      rows: [],
      count: 0,
      truncated: false,
    };
    mockRunSqlQuery.mockResolvedValue(fakeResult);

    const result = await dispatchTool('run_sql_query', { sql: 'SELECT 1' });

    expect(mockRunSqlQuery).toHaveBeenCalledOnce();
    expect(result).toBe(fakeResult);
  });

  it('passes sql and limit to runSqlQuery', async () => {
    mockRunSqlQuery.mockResolvedValue({ rows: [], count: 0, truncated: false });

    await dispatchTool('run_sql_query', {
      sql: 'SELECT * FROM jobs',
      limit: 25,
    });

    expect(mockRunSqlQuery).toHaveBeenCalledWith({
      sql: 'SELECT * FROM jobs',
      limit: 25,
    });
  });

  it('passes undefined limit when not provided', async () => {
    mockRunSqlQuery.mockResolvedValue({ rows: [], count: 0, truncated: false });

    await dispatchTool('run_sql_query', { sql: 'SELECT 1' });

    expect(mockRunSqlQuery).toHaveBeenCalledWith({
      sql: 'SELECT 1',
      limit: undefined,
    });
  });

  // ---------------------------------------------------------------------------
  // get_redis_stats
  // ---------------------------------------------------------------------------

  it('routes "get_redis_stats" to getRedisStats', async () => {
    const fakeStats: RedisStats = {
      hit_rate: 80,
      memory_used_mb: 5,
      connected_clients: 3,
      total_commands_processed: 1000,
      keyspace_hits: 800,
      keyspace_misses: 200,
      uptime_seconds: 3600,
    };
    mockGetRedisStats.mockResolvedValue(fakeStats);

    const result = await dispatchTool('get_redis_stats', {});

    expect(mockGetRedisStats).toHaveBeenCalledOnce();
    expect(result).toBe(fakeStats);
  });

  // ---------------------------------------------------------------------------
  // get_aws_costs
  // ---------------------------------------------------------------------------

  it('routes "get_aws_costs" to getAwsCosts', async () => {
    const fakeCosts: GetAwsCostsResult = {
      total_cost: 99.99,
      entries: [],
      currency: 'USD',
      period: { start: '2026-01-01', end: '2026-01-31' },
      group_by: 'SERVICE',
    };
    mockGetAwsCosts.mockResolvedValue(fakeCosts);

    const result = await dispatchTool(
      'get_aws_costs',
      { time_range: '30d', group_by: 'SERVICE' },
      fakeCredentials,
    );

    expect(mockGetAwsCosts).toHaveBeenCalledOnce();
    expect(result).toBe(fakeCosts);
  });

  it('forwards awsCredentials to getAwsCosts', async () => {
    mockGetAwsCosts.mockResolvedValue({
      total_cost: 0,
      entries: [],
      currency: 'USD',
      period: { start: '', end: '' },
      group_by: 'SERVICE',
    } as GetAwsCostsResult);

    await dispatchTool('get_aws_costs', {}, fakeCredentials);

    expect(mockGetAwsCosts).toHaveBeenCalledWith(
      expect.anything(),
      fakeCredentials,
    );
  });

  it('passes undefined awsCredentials when not provided', async () => {
    mockGetAwsCosts.mockResolvedValue({
      total_cost: 0,
      entries: [],
      currency: 'USD',
      period: { start: '', end: '' },
      group_by: 'SERVICE',
    } as GetAwsCostsResult);

    await dispatchTool('get_aws_costs', {});

    expect(mockGetAwsCosts).toHaveBeenCalledWith(expect.anything(), undefined);
  });

  // ---------------------------------------------------------------------------
  // Unknown tool
  // ---------------------------------------------------------------------------

  it('throws McpToolError for an unknown tool name', async () => {
    await expect(dispatchTool('non_existent_tool', {})).rejects.toBeInstanceOf(
      McpToolError,
    );
  });

  it('McpToolError message includes the unknown tool name', async () => {
    await expect(dispatchTool('mystery_tool', {})).rejects.toMatchObject({
      message: expect.stringContaining('mystery_tool'),
    });
  });
});
