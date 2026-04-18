import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { createLogger } from '../lib/logger.js';
import { db } from '../lib/database.js';
import { getDbSchema } from '../tools/get-db-schema.js';
import { runSqlQuery } from '../tools/run-sql-query.js';
import { startMcpHttp } from '../lib/start-mcp-http.js';
import { env } from '../config/env.js';

const log = createLogger({ service: 'mcp-postgres' });

function createServer(): McpServer {
  const server = new McpServer({
    name: 'postgres-server',
    version: '1.0.0',
  });

  server.registerTool(
    'get_db_schema',
    {
      title: 'Get Database Schema',
      description:
        'Query PostgreSQL information_schema to return all tables and their columns ' +
        '(name, data type, nullable, primary key, foreign key relationships). ' +
        'Call this FIRST before writing any SQL query so you know what tables and ' +
        'columns exist. Use this when the user asks about: database structure, ' +
        'what tables exist, what data is available, schema information.',
      inputSchema: {},
    },
    async () => {
      const toolLog = createLogger({ tool: 'get_db_schema' });
      toolLog.info('Tool invoked');
      try {
        const result = await getDbSchema();
        toolLog.info({ tableCount: result.tableCount }, 'Tool completed');
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result) }],
        };
      } catch (err) {
        toolLog.error({ err }, 'Tool failed');
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error retrieving schema: ${err instanceof Error ? err.message : 'Unknown error'}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    'run_sql_query',
    {
      title: 'Run SQL Query',
      description:
        'Execute a read-only SELECT query against PostgreSQL and return the results. ' +
        'Always call get_db_schema first to know the table structure. ' +
        'Only SELECT and WITH (CTE) queries are allowed — write operations are rejected. ' +
        'Use this when the user asks about: any data from the database, ' +
        'job failures, user records, errors, counts, statistics, anything stored in Postgres.',
      inputSchema: {
        sql: z
          .string()
          .min(1)
          .describe('A valid read-only SQL SELECT or WITH (CTE) query'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(200)
          .optional()
          .describe('Maximum rows to return (default 50, max 200)'),
      },
    },
    async ({ sql, limit }) => {
      const toolLog = createLogger({ tool: 'run_sql_query' });
      toolLog.info({ sql: sql.slice(0, 120) }, 'Tool invoked');
      try {
        const result = await runSqlQuery({ sql, limit });
        toolLog.info(
          { count: result.count, truncated: result.truncated },
          'Tool completed',
        );
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result) }],
        };
      } catch (err) {
        toolLog.error({ err }, 'Tool failed');
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error executing query: ${err instanceof Error ? err.message : 'Unknown error'}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  return server;
}

async function shutdown() {
  await db.end();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

const mode = process.argv.includes('--transport=http') ? 'http' : 'stdio';

if (mode === 'stdio') {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log.info('PostgreSQL MCP server running (stdio)');
} else {
  startMcpHttp(createServer, env.MCP_POSTGRES_HTTP_PORT, 'mcp-postgres');
  log.info(
    { port: env.MCP_POSTGRES_HTTP_PORT },
    'PostgreSQL MCP server running (HTTP)',
  );
}
