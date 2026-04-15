import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { createLogger } from '../lib/logger.js';
import { getAwsCosts } from '../tools/get-aws-costs.js';
import { startMcpHttp } from '../lib/start-mcp-http.js';
import { env } from '../config/env.js';
import type { CostTimeRange, CostGroupBy } from '../models/job.js';

const log = createLogger({ service: 'mcp-aws' });

function createServer(): McpServer {
  const server = new McpServer({
    name: 'aws-server',
    version: '1.0.0',
  });

  server.registerTool(
    'get_aws_costs',
    {
      title: 'Get AWS Costs',
      description:
        'Query AWS Cost Explorer API for cloud spending data broken down by service, region, or usage type. ' +
        'Returns cost per dimension in USD sorted by most expensive. ' +
        'Use this when the user asks about: AWS costs, cloud spend, billing, ' +
        'cost spikes, which service costs the most, EC2/S3/Lambda costs, ' +
        'budget analysis, cloud infrastructure expenses, why did costs increase.',
      inputSchema: {
        time_range: z
          .enum(['7d', '30d', '90d'])
          .describe('Time period for cost analysis'),
        group_by: z
          .enum(['SERVICE', 'REGION', 'USAGE_TYPE'])
          .default('SERVICE')
          .describe('How to group the cost breakdown'),
      },
    },
    async ({ time_range, group_by }) => {
      const toolLog = createLogger({
        tool: 'get_aws_costs',
        time_range,
        group_by,
      });
      toolLog.info('Tool invoked');

      try {
        const result = await getAwsCosts({
          time_range: time_range as CostTimeRange,
          group_by: group_by as CostGroupBy,
        });
        toolLog.info(
          { total_cost: result.total_cost, entry_count: result.entries.length },
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
              text: `Error fetching AWS costs: ${err instanceof Error ? err.message : 'Unknown error'}`,
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
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

const mode = process.argv.includes('--transport=http') ? 'http' : 'stdio';

if (mode === 'stdio') {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log.info('AWS MCP server running (stdio)');
} else {
  startMcpHttp(createServer, env.MCP_AWS_HTTP_PORT, 'mcp-aws');
  log.info({ port: env.MCP_AWS_HTTP_PORT }, 'AWS MCP server running (HTTP)');
}
