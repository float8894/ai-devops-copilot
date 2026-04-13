import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  CostExplorerClient,
  GetCostAndUsageCommand,
  type GetCostAndUsageCommandInput,
} from '@aws-sdk/client-cost-explorer';
import { createLogger } from '../lib/logger.js';
import { env } from '../config/env.js';
import type { AwsCostEntry, CostTimeRange, CostGroupBy } from '../models/job.js';

const log = createLogger({ service: 'mcp-aws' });

const server = new McpServer({
  name: 'aws-server',
  version: '1.0.0',
});

const costClient = new CostExplorerClient({ region: env.AWS_REGION });

function getDateRange(timeRange: CostTimeRange): { start: string; end: string } {
  const end = new Date();
  const start = new Date();
  const days: Record<CostTimeRange, number> = { '7d': 7, '30d': 30, '90d': 90 };
  start.setDate(end.getDate() - days[timeRange]);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { start: fmt(start), end: fmt(end) };
}

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
      const { start, end } = getDateRange(time_range as CostTimeRange);

      const params: GetCostAndUsageCommandInput = {
        TimePeriod: { Start: start, End: end },
        Granularity: 'MONTHLY',
        Metrics: ['UnblendedCost'],
        GroupBy: [
          { Type: 'DIMENSION', Key: group_by as CostGroupBy | undefined },
        ],
      };

      const response = await costClient.send(
        new GetCostAndUsageCommand(params),
      );

      const entries: AwsCostEntry[] = [];

      for (const result of response.ResultsByTime ?? []) {
        for (const group of result.Groups ?? []) {
          const amount = parseFloat(
            group.Metrics?.['UnblendedCost']?.Amount ?? '0',
          );
          if (amount < 0.01) continue; // Filter out negligible costs
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

      toolLog.info(
        { total_cost: totalCost, entry_count: entries.length },
        'Tool completed',
      );

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              entries,
              total_cost: Math.round(totalCost * 100) / 100,
              currency: 'USD',
              period: { start, end },
              group_by,
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
            text: `Error fetching AWS costs: ${err instanceof Error ? err.message : 'Unknown error'}`,
          },
        ],
        isError: true,
      };
    }
  },
);

async function shutdown() {
  await server.close();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

const transport = new StdioServerTransport();
await server.connect(transport);
log.info('AWS MCP server running');
