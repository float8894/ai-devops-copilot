import {
  CostExplorerClient,
  GetCostAndUsageCommand,
  type GetCostAndUsageCommandInput,
} from '@aws-sdk/client-cost-explorer';
import { env } from '../config/env.js';
import type {
  AwsCostEntry,
  CostTimeRange,
  CostGroupBy,
} from '../models/job.js';

const costClient = new CostExplorerClient({ region: env.AWS_REGION });

export interface GetAwsCostsInput {
  time_range?: CostTimeRange | undefined;
  group_by?: CostGroupBy | undefined;
}

export interface GetAwsCostsResult {
  entries: AwsCostEntry[];
  total_cost: number;
  currency: string;
  period: { start: string; end: string };
  group_by: CostGroupBy;
}

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

export async function getAwsCosts(
  input: GetAwsCostsInput,
): Promise<GetAwsCostsResult> {
  const time_range = input.time_range ?? '30d';
  const group_by = input.group_by ?? 'SERVICE';

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
