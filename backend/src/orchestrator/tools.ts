import type Anthropic from '@anthropic-ai/sdk';

export const tools: Anthropic.Tool[] = [
  {
    name: 'get_db_schema',
    description:
      'Query PostgreSQL information_schema to return all tables and columns ' +
      '(name, data type, nullable, primary key, foreign key relationships). ' +
      'Call this FIRST before writing any SQL query so you know what tables and ' +
      'columns exist. Use this when the user asks about: database structure, ' +
      'what tables exist, what data is available, schema information.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'run_sql_query',
    description:
      'Execute a read-only SELECT query against PostgreSQL and return the results. ' +
      'Always call get_db_schema first to know the table structure. ' +
      'Only SELECT and WITH (CTE) queries are allowed — write operations are rejected. ' +
      'Use this when the user asks about: any data from the database, ' +
      'job failures, user records, errors, counts, statistics, anything stored in Postgres.',
    input_schema: {
      type: 'object' as const,
      properties: {
        sql: {
          type: 'string',
          description: 'A valid read-only SQL SELECT or WITH (CTE) query',
        },
        limit: {
          type: 'number',
          description: 'Maximum rows to return (default 50, max 200)',
        },
      },
      required: ['sql'],
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
