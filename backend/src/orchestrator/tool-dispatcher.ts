import { McpToolError } from '../errors/index.js';
import { createLogger } from '../lib/logger.js';
import type { CostTimeRange, CostGroupBy } from '../models/job.js';
import type { AssumedCredentials } from '../lib/sts.js';
import { getDbSchema } from '../tools/get-db-schema.js';
import { runSqlQuery } from '../tools/run-sql-query.js';
import { getRedisStats } from '../tools/get-redis-stats.js';
import { getAwsCosts } from '../tools/get-aws-costs.js';

const log = createLogger({ service: 'tool-dispatcher' });

type ToolInput = Record<string, unknown>;

export async function dispatchTool(
  name: string,
  input: ToolInput,
  awsCredentials?: AssumedCredentials,
): Promise<unknown> {
  log.info({ tool: name }, 'Dispatching tool');

  switch (name) {
    case 'get_db_schema':
      return getDbSchema();
    case 'run_sql_query':
      return runSqlQuery({
        sql: input['sql'] as string,
        limit: typeof input['limit'] === 'number' ? input['limit'] : undefined,
      });
    case 'get_redis_stats':
      return getRedisStats();
    case 'get_aws_costs':
      return getAwsCosts(
        {
          time_range: input['time_range'] as CostTimeRange | undefined,
          group_by: input['group_by'] as CostGroupBy | undefined,
        },
        awsCredentials,
      );
    default:
      throw new McpToolError(`Unknown tool: ${name}`, name);
  }
}
