import { vi, describe, it, expect } from 'vitest';

// Capture the tool handler before any imports run
const captured = vi.hoisted<{
  handler:
    | ((args: { time_range: string; limit: number }) => Promise<{
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
    DATABASE_URL: 'postgres://localhost/test',
    MCP_POSTGRES_HTTP_PORT: 3001,
    REDIS_URL: 'redis://localhost:6379',
    MCP_REDIS_HTTP_PORT: 3002,
    MCP_AWS_HTTP_PORT: 3003,
    AWS_REGION: 'us-east-1',
    AWS_ACCESS_KEY_ID: 'test-key',
    AWS_SECRET_ACCESS_KEY: 'test-secret',
    JWT_SECRET: 'test-jwt-secret-that-is-at-least-32-chars',
    JWT_REFRESH_SECRET: 'test-refresh-secret-at-least-32-chars!!',
    PORT: 3000,
  },
}));

vi.mock('../lib/logger.js', () => ({
  createLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }),
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

vi.mock('../lib/database.js', () => ({
  db: { end: vi.fn().mockResolvedValue(undefined), on: vi.fn() },
  query: vi.fn(),
}));

vi.mock('../lib/start-mcp-http.js', () => ({
  startMcpHttp: vi.fn(),
}));

vi.mock('../tools/query-failed-jobs.js', () => ({
  queryFailedJobs: vi.fn(),
}));

// Import server module — triggers registerTool via top-level code
await import('../mcp-servers/postgres-server.js');
import { queryFailedJobs } from '../tools/query-failed-jobs.js';
import type { QueryFailedJobsResult } from '../tools/query-failed-jobs.js';

const mockQueryFailedJobs = vi.mocked(queryFailedJobs);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('postgres MCP server — query_failed_jobs handler', () => {
  it('captures the tool handler during server registration', () => {
    expect(captured.handler).not.toBeNull();
  });

  it('returns JSON content on successful tool call', async () => {
    const fakeResult: QueryFailedJobsResult = {
      count: 2,
      jobs: [
        {
          id: '1',
          name: 'SendEmail',
          status: 'failed',
          error_message: 'SMTP fail',
          created_at: new Date('2026-01-01'),
          updated_at: new Date('2026-01-01'),
        },
      ],
      time_range: '24h',
      error_patterns: { 'SMTP fail': 1 },
    };
    mockQueryFailedJobs.mockResolvedValue(fakeResult);

    const result = await captured.handler!({ time_range: '24h', limit: 10 });

    expect(result.isError).toBeUndefined();
    expect(result.content).toHaveLength(1);
    expect(result.content[0]?.type).toBe('text');
    expect(JSON.parse(result.content[0]?.text ?? '{}')).toEqual(
      JSON.parse(JSON.stringify(fakeResult)),
    );
  });

  it('returns isError:true when queryFailedJobs throws — never re-throws', async () => {
    mockQueryFailedJobs.mockRejectedValue(new Error('Connection refused'));

    const result = await captured.handler!({ time_range: '24h', limit: 10 });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('Error');
  });

  it('includes the error message in the error response', async () => {
    mockQueryFailedJobs.mockRejectedValue(new Error('DB down'));

    const result = await captured.handler!({ time_range: '1h', limit: 5 });

    expect(result.content[0]?.text).toContain('DB down');
  });
});
