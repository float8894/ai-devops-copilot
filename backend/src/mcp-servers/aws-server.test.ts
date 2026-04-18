import { vi, describe, it, expect } from 'vitest';

const captured = vi.hoisted<{
  handler:
    | ((args: { time_range: string; group_by: string }) => Promise<{
        content: Array<{ type: string; text: string }>;
        isError?: boolean;
      }>)
    | null;
}>(() => ({ handler: null }));

vi.mock('@modelcontextprotocol/sdk/server/mcp.js', () => ({
  McpServer: vi.fn().mockImplementation(function () {
    return {
      registerTool: (
        _name: string,
        _cfg: unknown,
        handler: typeof captured.handler,
      ) => {
        captured.handler = handler;
      },
      connect: vi.fn().mockResolvedValue(undefined),
    };
  }),
}));

vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: vi.fn().mockImplementation(function () {
    return {};
  }),
}));

vi.mock('../config/env.js', () => ({
  env: {
    MCP_AWS_HTTP_PORT: 3003,
    PORT: 3000,
    JWT_SECRET: 'test-jwt-secret-that-is-at-least-32-chars',
    JWT_REFRESH_SECRET: 'test-refresh-secret-at-least-32-chars!!',
    DATABASE_URL: 'postgres://localhost/test',
    REDIS_URL: 'redis://localhost:6379',
    AWS_REGION: 'us-east-1',
    AWS_ACCESS_KEY_ID: 'test-key',
    AWS_SECRET_ACCESS_KEY: 'test-secret',
  },
}));

vi.mock('../lib/logger.js', () => ({
  createLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }),
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

vi.mock('../lib/start-mcp-http.js', () => ({
  startMcpHttp: vi.fn(),
}));

vi.mock('../tools/get-aws-costs.js', () => ({
  getAwsCosts: vi.fn(),
}));

await import('../mcp-servers/aws-server.js');
import { getAwsCosts } from '../tools/get-aws-costs.js';
import type { GetAwsCostsResult } from '../tools/get-aws-costs.js';

const mockGetAwsCosts = vi.mocked(getAwsCosts);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('aws MCP server — get_aws_costs handler', () => {
  it('captures the tool handler during server registration', () => {
    expect(captured.handler).not.toBeNull();
  });

  it('returns JSON content on successful tool call', async () => {
    const fakeCosts: GetAwsCostsResult = {
      total_cost: 123.45,
      currency: 'USD',
      period: { start: '2026-01-01', end: '2026-01-31' },
      group_by: 'SERVICE',
      entries: [
        {
          service: 'Amazon EC2',
          amount: 100,
          currency: 'USD',
          period_start: '2026-01-01',
          period_end: '2026-01-31',
        },
      ],
    };
    mockGetAwsCosts.mockResolvedValue(fakeCosts);

    const result = await captured.handler!({
      time_range: '30d',
      group_by: 'SERVICE',
    });

    expect(result.isError).toBeUndefined();
    expect(result.content).toHaveLength(1);
    expect(result.content[0]?.type).toBe('text');
    expect(JSON.parse(result.content[0]?.text ?? '{}')).toEqual(fakeCosts);
  });

  it('returns isError:true when getAwsCosts throws — never re-throws', async () => {
    mockGetAwsCosts.mockRejectedValue(new Error('AccessDeniedException'));

    const result = await captured.handler!({
      time_range: '7d',
      group_by: 'SERVICE',
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('Error');
  });

  it('includes the error message in the error response', async () => {
    mockGetAwsCosts.mockRejectedValue(
      new Error('ThrottlingException: rate exceeded'),
    );

    const result = await captured.handler!({
      time_range: '30d',
      group_by: 'REGION',
    });

    expect(result.content[0]?.text).toContain('ThrottlingException');
  });
});
