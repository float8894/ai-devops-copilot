import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { createLogger } from '../lib/logger.js';
import { db } from '../lib/database.js';
import { queryFailedJobs } from '../tools/query-failed-jobs.js';

const log = createLogger({ service: 'mcp-postgres' });

const server = new McpServer({
  name: 'postgres-server',
  version: '1.0.0',
});

server.registerTool(
  'query_failed_jobs',
  {
    title: 'Query Failed Jobs',
    description:
      'Query PostgreSQL for failed background jobs within a time range. ' +
      'Returns job id, name, error message, and timestamp. ' +
      'Use this when the user asks about: job failures, task errors, ' +
      'failed processes, background job status, what went wrong, error patterns, ' +
      'which jobs failed, job queue issues.',
    inputSchema: {
      time_range: z
        .enum(['1h', '24h', '7d', '30d'])
        .describe('How far back to look for failed jobs'),
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .default(20)
        .describe('Maximum number of results to return'),
    },
  },
  async ({ time_range, limit }) => {
    const toolLog = createLogger({ tool: 'query_failed_jobs', time_range });
    toolLog.info({ limit }, 'Tool invoked');

    try {
      const result = await queryFailedJobs({ time_range, limit });
      toolLog.info({ count: result.count }, 'Tool completed');
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
      };
    } catch (err) {
      toolLog.error({ err }, 'Tool failed');
      return {
        content: [
          {
            type: 'text' as const,
            text: `Error querying failed jobs: ${err instanceof Error ? err.message : 'Unknown error'}`,
          },
        ],
        isError: true,
      };
    }
  },
);

async function shutdown() {
  await db.end();
  await server.close();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

const transport = new StdioServerTransport();
await server.connect(transport);
log.info('PostgreSQL MCP server running');
