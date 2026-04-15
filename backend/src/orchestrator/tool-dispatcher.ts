import { McpToolError } from '../errors/index.js';
import { createLogger } from '../lib/logger.js';
import type { TimeRange, CostTimeRange, CostGroupBy } from '../models/job.js';
import { queryFailedJobs } from '../tools/query-failed-jobs.js';
import { getRedisStats } from '../tools/get-redis-stats.js';
import { getAwsCosts } from '../tools/get-aws-costs.js';

const log = createLogger({ service: 'tool-dispatcher' });

type ToolInput = Record<string, unknown>;

export async function dispatchTool(
  name: string,
  input: ToolInput,
): Promise<unknown> {
  log.info({ tool: name }, 'Dispatching tool');

  switch (name) {
    case 'query_failed_jobs':
      return queryFailedJobs({
        time_range: input['time_range'] as TimeRange | undefined,
        limit: typeof input['limit'] === 'number' ? input['limit'] : undefined,
      });
    case 'get_redis_stats':
      return getRedisStats();
    case 'get_aws_costs':
      return getAwsCosts({
        time_range: input['time_range'] as CostTimeRange | undefined,
        group_by: input['group_by'] as CostGroupBy | undefined,
      });
    default:
      throw new McpToolError(`Unknown tool: ${name}`, name);
  }
}
