import { McpToolError } from '../errors/index.js';
import { query } from '../lib/database.js';
import { redis } from '../lib/redis.js';
import {
  CostExplorerClient,
  GetCostAndUsageCommand,
  type GetCostAndUsageCommandInput,
} from '@aws-sdk/client-cost-explorer';
import { createLogger } from '../lib/logger.js';
import { env } from '../config/env.js';
import type {
  JobRow,
  TimeRange,
  CostTimeRange,
  CostGroupBy,
  RedisStats,
  AwsCostEntry,
} from '../models/job.js';

const log = createLogger({ service: 'tool-dispatcher' });

const costClient = new CostExplorerClient({ region: env.AWS_REGION });

type ToolInput = Record<string, unknown>;

// --- query_failed_jobs ---

const intervalMap: Record<TimeRange, string> = {
  '1h': '1 hour',
  '24h': '24 hours',
  '7d': '7 days',
  '30d': '30 days',
};

async function queryFailedJobs(input: ToolInput): Promise<unknown> {
  const time_range = (input['time_range'] as TimeRange) ?? '24h';
  const limit = typeof input['limit'] === 'number' ? input['limit'] : 20;

  const rows = await query<JobRow>(
    `SELECT id, name, status, error_message, created_at
     FROM jobs
     WHERE status = 'failed'
       AND created_at > NOW() - $1::interval
     ORDER BY created_at DESC
     LIMIT $2`,
    [intervalMap[time_range], limit],
  );

  const errorPatterns: Record<string, number> = {};
  for (const row of rows) {
    const key = row.error_message ?? 'Unknown error';
    errorPatterns[key] = (errorPatterns[key] ?? 0) + 1;
  }

  return {
    jobs: rows,
    count: rows.length,
    time_range,
    error_patterns: errorPatterns,
  };
}

// --- get_redis_stats ---

async function getRedisStats(): Promise<RedisStats> {
  // Ensure connected — with lazyConnect + enableOfflineQueue:false we must
  // explicitly reconnect if the stream was closed (e.g. after a watch reload)
  if (
    redis.status === 'close' ||
    redis.status === 'end' ||
    redis.status === 'wait'
  ) {
    await redis.connect();
  }

  const info = await redis.info();

  const parsed: Record<string, string> = {};
  for (const line of info.split('\r\n')) {
    if (line.startsWith('#') || line.trim() === '') continue;
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    parsed[line.slice(0, colonIdx).trim()] = line.slice(colonIdx + 1).trim();
  }

  const hits = parseInt(parsed['keyspace_hits'] ?? '0', 10);
  const misses = parseInt(parsed['keyspace_misses'] ?? '0', 10);
  const total = hits + misses;
  const hitRate = total > 0 ? Math.round((hits / total) * 10000) / 100 : 0;

  const memBytes = parseInt(parsed['used_memory'] ?? '0', 10);

  return {
    hit_rate: hitRate,
    memory_used_mb: Math.round((memBytes / 1024 / 1024) * 100) / 100,
    connected_clients: parseInt(parsed['connected_clients'] ?? '0', 10),
    total_commands_processed: parseInt(
      parsed['total_commands_processed'] ?? '0',
      10,
    ),
    keyspace_hits: hits,
    keyspace_misses: misses,
    uptime_seconds: parseInt(parsed['uptime_in_seconds'] ?? '0', 10),
  };
}

// --- get_aws_costs ---

function getDateRange(timeRange: CostTimeRange): {
  start: string;
  end: string;
} {
  const end = new Date();
  const start = new Date();
  const days: Record<CostTimeRange, number> = { '7d': 7, '30d': 30, '90d': 90 };
  start.setDate(end.getDate() - days[timeRange]);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { start: fmt(start), end: fmt(end) };
}

async function getAwsCosts(input: ToolInput): Promise<unknown> {
  const time_range = (input['time_range'] as CostTimeRange) ?? '30d';
  const group_by = (input['group_by'] as CostGroupBy | undefined) ?? 'SERVICE';

  const { start, end } = getDateRange(time_range);

  const params: GetCostAndUsageCommandInput = {
    TimePeriod: { Start: start, End: end },
    Granularity: 'MONTHLY',
    Metrics: ['UnblendedCost'],
    GroupBy: [{ Type: 'DIMENSION', Key: group_by }],
  };

  const response = await costClient.send(new GetCostAndUsageCommand(params));

  const entries: AwsCostEntry[] = [];

  for (const result of response.ResultsByTime ?? []) {
    for (const group of result.Groups ?? []) {
      const amount = parseFloat(
        group.Metrics?.['UnblendedCost']?.Amount ?? '0',
      );
      if (amount < 0.01) continue;
      entries.push({
        service: group.Keys?.[0] ?? 'Unknown',
        amount: Math.round(amount * 100) / 100,
        currency: group.Metrics?.['UnblendedCost']?.Unit ?? 'USD',
        period_start: result.TimePeriod?.Start ?? start,
        period_end: result.TimePeriod?.End ?? end,
      });
    }
  }

  entries.sort((a, b) => b.amount - a.amount);
  const totalCost = entries.reduce((sum, e) => sum + e.amount, 0);

  return {
    entries,
    total_cost: Math.round(totalCost * 100) / 100,
    currency: 'USD',
    period: { start, end },
    group_by,
  };
}

// --- dispatcher ---

export async function dispatchTool(
  name: string,
  input: ToolInput,
): Promise<unknown> {
  log.info({ tool: name }, 'Dispatching tool');

  switch (name) {
    case 'query_failed_jobs':
      return queryFailedJobs(input);
    case 'get_redis_stats':
      return getRedisStats();
    case 'get_aws_costs':
      return getAwsCosts(input);
    default:
      throw new McpToolError(`Unknown tool: ${name}`, name);
  }
}
