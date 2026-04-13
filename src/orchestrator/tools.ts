import type Anthropic from '@anthropic-ai/sdk';

export const tools: Anthropic.Tool[] = [
  {
    name: 'query_failed_jobs',
    description:
      'Query PostgreSQL for failed background jobs within a time range. ' +
      'Returns job id, name, error message, timestamp, and error patterns grouped by message. ' +
      'Use this when the user asks about: job failures, task errors, failed processes, ' +
      'background job status, what went wrong, error patterns, which jobs failed, job queue issues.',
    input_schema: {
      type: 'object' as const,
      properties: {
        time_range: {
          type: 'string',
          enum: ['1h', '24h', '7d', '30d'],
          description: 'How far back to look for failures',
        },
        limit: {
          type: 'number',
          description: 'Maximum results to return (default 20, max 100)',
        },
      },
      required: ['time_range'],
    },
  },
  {
    name: 'get_redis_stats',
    description:
      'Get Redis cache performance statistics including hit rate, memory usage in MB, ' +
      'and connected clients by running the Redis INFO command. ' +
      'Use this when the user asks about: cache performance, Redis health, ' +
      'cache hit rate, memory usage, cache anomalies, slow responses, ' +
      'cache efficiency, Redis status, is the cache healthy.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'get_aws_costs',
    description:
      'Query AWS Cost Explorer API for cloud spending data broken down by service or region. ' +
      'Returns cost per service in USD sorted by most expensive. ' +
      'Use this when the user asks about: AWS costs, cloud spend, billing, ' +
      'cost spikes, which service costs the most, EC2 costs, S3 costs, ' +
      'budget analysis, cloud infrastructure expenses, why did costs increase.',
    input_schema: {
      type: 'object' as const,
      properties: {
        time_range: {
          type: 'string',
          enum: ['7d', '30d', '90d'],
          description: 'Time period for cost analysis',
        },
        group_by: {
          type: 'string',
          enum: ['SERVICE', 'REGION', 'USAGE_TYPE'],
          description: 'How to group the cost breakdown (default: SERVICE)',
        },
      },
      required: ['time_range'],
    },
  },
];
