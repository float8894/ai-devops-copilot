import { vi, describe, it, expect } from 'vitest';

const captured = vi.hoisted<{
  handler:
    | (() => Promise<{
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
    REDIS_URL: 'redis://localhost:6379',
    MCP_REDIS_HTTP_PORT: 3002,
    PORT: 3000,
    JWT_SECRET: 'test-jwt-secret-that-is-at-least-32-chars',
    JWT_REFRESH_SECRET: 'test-refresh-secret-at-least-32-chars!!',
    DATABASE_URL: 'postgres://localhost/test',
    AWS_REGION: 'us-east-1',
    AWS_ACCESS_KEY_ID: 'test-key',
    AWS_SECRET_ACCESS_KEY: 'test-secret',
  },
}));

vi.mock('../lib/logger.js', () => ({
  createLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }),
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

vi.mock('../lib/redis.js', () => ({
  redis: {
    status: 'ready',
    info: vi.fn(),
    connect: vi.fn(),
    quit: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../lib/start-mcp-http.js', () => ({
  startMcpHttp: vi.fn(),
}));

vi.mock('../tools/get-redis-stats.js', () => ({
  getRedisStats: vi.fn(),
}));

await import('../mcp-servers/redis-server.js');
import { getRedisStats } from '../tools/get-redis-stats.js';
import type { RedisStats } from '../models/job.js';

const mockGetRedisStats = vi.mocked(getRedisStats);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('redis MCP server — get_redis_stats handler', () => {
  it('captures the tool handler during server registration', () => {
    expect(captured.handler).not.toBeNull();
  });

  it('returns JSON content on successful tool call', async () => {
    const fakeStats: RedisStats = {
      hit_rate: 80,
      memory_used_mb: 5,
      connected_clients: 3,
      total_commands_processed: 1000,
      keyspace_hits: 800,
      keyspace_misses: 200,
      uptime_seconds: 3600,
    };
    mockGetRedisStats.mockResolvedValue(fakeStats);

    const result = await captured.handler!();

    expect(result.isError).toBeUndefined();
    expect(result.content).toHaveLength(1);
    expect(result.content[0]?.type).toBe('text');
    expect(JSON.parse(result.content[0]?.text ?? '{}')).toEqual(fakeStats);
  });

  it('returns isError:true when getRedisStats throws — never re-throws', async () => {
    mockGetRedisStats.mockRejectedValue(new Error('Redis unreachable'));

    const result = await captured.handler!();

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('Error');
  });

  it('includes the error message in the error response', async () => {
    mockGetRedisStats.mockRejectedValue(new Error('ECONNREFUSED'));

    const result = await captured.handler!();

    expect(result.content[0]?.text).toContain('ECONNREFUSED');
  });
});
