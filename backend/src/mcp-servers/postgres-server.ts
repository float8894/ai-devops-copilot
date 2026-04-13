import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { createLogger } from '../lib/logger.js';
import { query } from '../lib/database.js';
import { db } from '../lib/database.js';
import type { JobRow, TimeRange } from '../models/job.js';

const log = createLogger({ service: 'mcp-postgres' });

const server = new McpServer({
  name: 'postgres-server',
  version: '1.0.0',
});

const intervalMap: Record<TimeRange, string> = {
  '1h': '1 hour',
  '24h': '24 hours',
  '7d': '7 days',
  '30d': '30 days',
};

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
      const rows = await query<JobRow>(
        `SELECT id, name, status, error_message, created_at
         FROM jobs
         WHERE status = 'failed'
           AND created_at > NOW() - $1::interval
         ORDER BY created_at DESC
         LIMIT $2`,
        [intervalMap[time_range as TimeRange], limit],
      );

      // Group errors by message to surface patterns
      const errorPatterns: Record<string, number> = {};
      for (const row of rows) {
        const key = row.error_message ?? 'Unknown error';
        errorPatterns[key] = (errorPatterns[key] ?? 0) + 1;
      }

      toolLog.info({ count: rows.length }, 'Tool completed');

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              jobs: rows,
              count: rows.length,
              time_range,
              error_patterns: errorPatterns,
            }),
          },
        ],
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
