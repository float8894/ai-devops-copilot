import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../config/env.js', () => ({
  env: {
    AWS_REGION: 'us-east-1',
    AWS_ACCESS_KEY_ID: 'AKIATEST',
    AWS_SECRET_ACCESS_KEY: 'test-secret',
    JWT_SECRET: 'test-jwt-secret-that-is-at-least-32-characters',
    JWT_REFRESH_SECRET: 'test-refresh-secret-that-is-at-least-32-chars',
    ANTHROPIC_API_KEY: 'sk-ant-test',
    DATABASE_URL: 'postgresql://localhost/test',
    REDIS_URL: 'redis://localhost',
    ALLOWED_ORIGIN: 'http://localhost:4200',
    NODE_ENV: 'test',
    PORT: 3000,
    MCP_POSTGRES_HTTP_PORT: 3001,
    MCP_REDIS_HTTP_PORT: 3002,
    MCP_AWS_HTTP_PORT: 3003,
  },
}));

const mockSend = vi.fn();
vi.mock('@aws-sdk/client-cost-explorer', () => ({
  // eslint-disable-next-line prefer-arrow-callback
  CostExplorerClient: vi.fn().mockImplementation(function () {
    return { send: mockSend };
  }),
  GetCostAndUsageCommand: vi.fn().mockImplementation(function (
    params: unknown,
  ) {
    return params;
  }),
}));

import { getAwsCosts } from './get-aws-costs.js';
import { CostExplorerClient } from '@aws-sdk/client-cost-explorer';

const MockCostExplorerClient = vi.mocked(CostExplorerClient);

beforeEach(() => {
  vi.clearAllMocks();
  MockCostExplorerClient.mockImplementation(function () {
    return { send: mockSend };
  });
});

const makeCostResponse = (
  groups: Array<{ key: string; amount: string }>,
  currency = 'USD',
) => ({
  ResultsByTime: [
    {
      TimePeriod: { Start: '2026-03-01', End: '2026-03-31' },
      Groups: groups.map((g) => ({
        Keys: [g.key],
        Metrics: { UnblendedCost: { Amount: g.amount, Unit: currency } },
      })),
    },
  ],
});

describe('getAwsCosts', () => {
  it('returns aggregated entries sorted by amount descending', async () => {
    mockSend.mockResolvedValueOnce(
      makeCostResponse([
        { key: 'Amazon EC2', amount: '150.00' },
        { key: 'Amazon S3', amount: '25.50' },
        { key: 'Amazon RDS', amount: '75.00' },
      ]),
    );

    const result = await getAwsCosts({
      time_range: '30d',
      group_by: 'SERVICE',
    });

    expect(result.entries).toHaveLength(3);
    expect(result.entries[0]?.service).toBe('Amazon EC2');
    expect(result.entries[0]?.amount).toBe(150);
    expect(result.total_cost).toBe(250.5);
    expect(result.currency).toBe('USD');
    expect(result.group_by).toBe('SERVICE');
  });

  it('filters out entries below 0.01', async () => {
    mockSend.mockResolvedValueOnce(
      makeCostResponse([
        { key: 'Amazon EC2', amount: '10.00' },
        { key: 'Tax', amount: '0.005' },
      ]),
    );

    const result = await getAwsCosts({});
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]?.service).toBe('Amazon EC2');
  });

  it('returns empty entries and zero total when no results', async () => {
    mockSend.mockResolvedValueOnce({ ResultsByTime: [] });

    const result = await getAwsCosts({});
    expect(result.entries).toEqual([]);
    expect(result.total_cost).toBe(0);
  });

  it('passes assumed credentials to the CostExplorerClient', async () => {
    mockSend.mockResolvedValueOnce({ ResultsByTime: [] });

    await getAwsCosts(
      { time_range: '7d' },
      {
        accessKeyId: 'AKIASSUMED',
        secretAccessKey: 'assumed-secret',
        sessionToken: 'token-xyz',
      },
    );

    expect(MockCostExplorerClient).toHaveBeenCalledWith(
      expect.objectContaining({
        credentials: expect.objectContaining({
          accessKeyId: 'AKIASSUMED',
          sessionToken: 'token-xyz',
        }),
      }),
    );
  });

  it('uses server-level credentials when no assumed credentials provided', async () => {
    mockSend.mockResolvedValueOnce({ ResultsByTime: [] });

    await getAwsCosts({ time_range: '7d' });

    // When no credentials, client is built without explicit credentials
    expect(MockCostExplorerClient).toHaveBeenCalledWith(
      expect.objectContaining({ region: 'us-east-1' }),
    );
    const callArg = MockCostExplorerClient.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(callArg?.['credentials']).toBeUndefined();
  });

  it('defaults to 30d time_range and SERVICE group_by', async () => {
    mockSend.mockResolvedValueOnce({ ResultsByTime: [] });

    const result = await getAwsCosts({});

    expect(result.group_by).toBe('SERVICE');
    // period end should be today's date
    expect(result.period.end).toBe(new Date().toISOString().slice(0, 10));
  });

  it('throws on CostExplorer API failure', async () => {
    mockSend.mockRejectedValueOnce(new Error('AccessDenied'));

    await expect(getAwsCosts({})).rejects.toThrow('AccessDenied');
  });
});
