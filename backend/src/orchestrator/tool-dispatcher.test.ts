import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { QueryFailedJobsResult } from '../tools/query-failed-jobs.js';
import type { GetAwsCostsResult } from '../tools/get-aws-costs.js';
import type { RedisStats } from '../models/job.js';

vi.mock('../tools/query-failed-jobs.js', () => ({
  queryFailedJobs: vi.fn(),
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
import { queryFailedJobs } from '../tools/query-failed-jobs.js';
import { getRedisStats } from '../tools/get-redis-stats.js';
import { getAwsCosts } from '../tools/get-aws-costs.js';
import { McpToolError } from '../errors/index.js';

const mockQueryFailedJobs = vi.mocked(queryFailedJobs);
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
  // query_failed_jobs
  // ---------------------------------------------------------------------------

  it('routes "query_failed_jobs" to queryFailedJobs', async () => {
    const fakeResult = {
      count: 1,
      jobs: [],
      time_range: '24h',
      error_patterns: {},
    } as QueryFailedJobsResult;
    mockQueryFailedJobs.mockResolvedValue(fakeResult);

    const result = await dispatchTool('query_failed_jobs', {
      time_range: '24h',
      limit: 10,
    });

    expect(mockQueryFailedJobs).toHaveBeenCalledOnce();
    expect(result).toBe(fakeResult);
  });

  it('passes time_range and limit to queryFailedJobs', async () => {
    mockQueryFailedJobs.mockResolvedValue({
      count: 0,
      jobs: [],
      time_range: '7d',
      error_patterns: {},
    } as QueryFailedJobsResult);

    await dispatchTool('query_failed_jobs', { time_range: '7d', limit: 50 });

    expect(mockQueryFailedJobs).toHaveBeenCalledWith({
      time_range: '7d',
      limit: 50,
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
