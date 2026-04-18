import { vi, describe, it, expect } from 'vitest';

type ToolHandler = (args: Record<string, unknown>) => Promise<{
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}>;

// Capture tool handlers keyed by tool name before any imports run
const captured = vi.hoisted<{
  schemaHandler: ToolHandler | null;
  sqlHandler: ToolHandler | null;
}>(() => ({ schemaHandler: null, sqlHandler: null }));

vi.mock('@modelcontextprotocol/sdk/server/mcp.js', () => ({
  McpServer: vi.fn().mockImplementation(function () {
    return {
      registerTool: (name: string, _cfg: unknown, handler: ToolHandler) => {
        if (name === 'get_db_schema') captured.schemaHandler = handler;
        else if (name === 'run_sql_query') captured.sqlHandler = handler;
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

vi.mock('../tools/get-db-schema.js', () => ({
  getDbSchema: vi.fn(),
}));

vi.mock('../tools/run-sql-query.js', () => ({
  runSqlQuery: vi.fn(),
}));

// Import server module — triggers registerTool via top-level code
await import('../mcp-servers/postgres-server.js');
import { getDbSchema } from '../tools/get-db-schema.js';
import { runSqlQuery } from '../tools/run-sql-query.js';
import type { DbSchemaResult } from '../tools/get-db-schema.js';
import type { RunSqlQueryResult } from '../tools/run-sql-query.js';

const mockGetDbSchema = vi.mocked(getDbSchema);
const mockRunSqlQuery = vi.mocked(runSqlQuery);

// ---------------------------------------------------------------------------
// Tests — get_db_schema handler
// ---------------------------------------------------------------------------

describe('postgres MCP server — get_db_schema handler', () => {
  it('captures the get_db_schema handler during server registration', () => {
    expect(captured.schemaHandler).not.toBeNull();
  });

  it('returns JSON content on successful schema fetch', async () => {
    const fakeResult: DbSchemaResult = {
      tables: [
        {
          name: 'jobs',
          columns: [
            {
              name: 'id',
              type: 'uuid',
              nullable: false,
              isPrimaryKey: true,
              isForeignKey: false,
            },
          ],
        },
      ],
      tableCount: 1,
    };
    mockGetDbSchema.mockResolvedValue(fakeResult);

    const result = await captured.schemaHandler!({});

    expect(result.isError).toBeUndefined();
    expect(result.content).toHaveLength(1);
    expect(result.content[0]?.type).toBe('text');
    expect(JSON.parse(result.content[0]?.text ?? '{}')).toEqual(
      JSON.parse(JSON.stringify(fakeResult)),
    );
  });

  it('returns isError:true when getDbSchema throws — never re-throws', async () => {
    mockGetDbSchema.mockRejectedValue(new Error('Connection refused'));

    const result = await captured.schemaHandler!({});

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('Error');
  });

  it('includes the error message in the error response', async () => {
    mockGetDbSchema.mockRejectedValue(new Error('schema query failed'));

    const result = await captured.schemaHandler!({});

    expect(result.content[0]?.text).toContain('schema query failed');
  });
});

// ---------------------------------------------------------------------------
// Tests — run_sql_query handler
// ---------------------------------------------------------------------------

describe('postgres MCP server — run_sql_query handler', () => {
  it('captures the run_sql_query handler during server registration', () => {
    expect(captured.sqlHandler).not.toBeNull();
  });

  it('returns JSON content on successful query', async () => {
    const fakeResult: RunSqlQueryResult = {
      rows: [{ id: 1, name: 'test' }],
      count: 1,
      truncated: false,
    };
    mockRunSqlQuery.mockResolvedValue(fakeResult);

    const result = await captured.sqlHandler!({ sql: 'SELECT 1' });

    expect(result.isError).toBeUndefined();
    expect(result.content).toHaveLength(1);
    expect(result.content[0]?.type).toBe('text');
    expect(JSON.parse(result.content[0]?.text ?? '{}')).toEqual(fakeResult);
  });

  it('returns isError:true when runSqlQuery throws — never re-throws', async () => {
    mockRunSqlQuery.mockRejectedValue(new Error('read-only transaction'));

    const result = await captured.sqlHandler!({ sql: 'DELETE FROM jobs' });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('Error');
  });

  it('includes the error message in the sql error response', async () => {
    mockRunSqlQuery.mockRejectedValue(new Error('syntax error at position 5'));

    const result = await captured.sqlHandler!({ sql: 'SELEC 1' });

    expect(result.content[0]?.text).toContain('syntax error at position 5');
  });
});
