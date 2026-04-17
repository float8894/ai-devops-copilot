---
name: node24
description: >
  Use this skill whenever writing Node.js backend code for this project.
  Covers MCP servers, Express APIs, TypeScript setup, PostgreSQL, Redis,
  AWS SDK, error handling, logging, validation, and testing. Always follow
  Node 24+ best practices. Never use CommonJS, never use ts-node, never use
  console.log in production code, never use 'any' in TypeScript.
---

# Node 24 + TypeScript Coding Skill

You are an expert Node.js 24 backend developer. Always write modern,
idiomatic Node 24+ code with strict TypeScript. Read the reference files
for detailed patterns before generating complex code.

---

## Core Node 24 Principles

### 1. ESM Modules — Always
`"type": "module"` in package.json. Use `node:` prefix for all built-ins.
Never use `require()` or CommonJS.

```typescript
// ✅ Correct
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

// ❌ Never
const fs = require('fs');
import fs from 'fs'; // missing node: prefix
```

### 2. TypeScript — Strict Always
No `any`. No type assertions unless absolutely unavoidable.
Use `unknown` for truly uncertain types. Use `satisfies` over casting.

```typescript
// tsconfig.json — always use these settings
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "esModuleInterop": true,       // required for CJS packages like pino, pg, ioredis
    "skipLibCheck": true,           // avoids type errors in third-party packages
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true,
    "sourceMap": true
  }
}
```

### 3. tsx for Development, tsc for Production
Never use ts-node. Use tsx for running TypeScript directly in development.

```json
// package.json scripts
{
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "test": "vitest"
  }
}
```

### 4. Native .env Loading — No dotenv Package
Node 24 loads .env natively. Validate all env vars at startup with Zod.
Fail fast if anything is missing.

```typescript
// src/config/env.ts
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  ANTHROPIC_API_KEY: z.string().min(1),
  AWS_REGION: z.string().default('us-east-1'),
  AWS_ACCESS_KEY_ID: z.string().min(1),
  AWS_SECRET_ACCESS_KEY: z.string().min(1),
  ALLOWED_ORIGIN: z.string().default('http://localhost:4200'),
});

export const env = envSchema.parse(process.env);
// If any var is missing, process exits immediately with a clear error
```

Run with: `node --env-file=.env dist/index.js`

### 5. Async/Await — No Callbacks, No Mixed Patterns
Always async/await. Use Promise.all for parallel work.
Use Promise.allSettled when all results are needed even if some fail.

```typescript
// ✅ Parallel execution
const [costData, jobData, cacheStats] = await Promise.all([
  fetchAwsCosts(timeRange),
  queryFailedJobs(timeRange),
  getRedisStats(),
]);

// ✅ Parallel with partial failure tolerance
const results = await Promise.allSettled([
  fetchAwsCosts(timeRange),
  queryFailedJobs(timeRange),
]);

results.forEach((result, i) => {
  if (result.status === 'rejected') {
    logger.error({ err: result.reason }, `Tool ${i} failed`);
  }
});
```

### 6. Error Handling — Custom Classes + cause
Never throw plain strings. Always use custom error classes.
Always include cause when wrapping errors.

```typescript
// src/errors/index.ts
export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 500,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class DatabaseError extends AppError {
  constructor(message: string, cause?: unknown) {
    super(message, 'DATABASE_ERROR', 500, { cause });
  }
}

export class McpToolError extends AppError {
  constructor(message: string, public readonly toolName: string, cause?: unknown) {
    super(message, 'MCP_TOOL_ERROR', 500, { cause });
  }
}

export class ValidationError extends AppError {
  constructor(message: string, cause?: unknown) {
    super(message, 'VALIDATION_ERROR', 400, { cause });
  }
}

// Usage
try {
  await db.query(sql);
} catch (err) {
  throw new DatabaseError('Failed to query jobs table', err);
}
```

### 7. Structured Logging with Pino
Never use console.log in production code. Use pino.
Always include requestId in every log line.

```typescript
// src/lib/logger.ts
import pino from 'pino';
import { env } from '../config/env.js';

export const logger = pino({
  level: env.NODE_ENV === 'production' ? 'info' : 'debug',
  transport: env.NODE_ENV !== 'production'
    ? { target: 'pino-pretty', options: { colorize: true } }
    : undefined,
});

// Child logger with context
export const createLogger = (context: Record<string, unknown>) =>
  logger.child(context);

// Usage in MCP server
const log = createLogger({ service: 'mcp-postgres', tool: 'query_failed_jobs' });
log.info({ timeRange }, 'Tool invoked');
log.error({ err }, 'Tool failed');
```

---

## MCP Server Patterns

### Package Installation
```bash
# Use the monolithic SDK package — v1.x is production stable
# v2 (split packages @modelcontextprotocol/server + @modelcontextprotocol/client) is pre-alpha
# Do NOT use v2 split packages yet — they are not production ready as of April 2026
npm install @modelcontextprotocol/sdk@^1 zod
```

### MCP Server Structure
Each MCP server is a standalone Node.js process. One file per server.
Use `server.registerTool()` — NOT `server.tool()` (that was old API).

```typescript
// src/mcp-servers/postgres-server.ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { createLogger } from '../lib/logger.js';
import { McpToolError } from '../errors/index.js';
import { query } from '../lib/database.js';

const log = createLogger({ service: 'mcp-postgres' });

const server = new McpServer({
  name: 'postgres-server',
  version: '1.0.0',
});

// ✅ Correct API: server.registerTool() with inline Zod schema properties
// ❌ Wrong: server.tool() — old/removed API
// ❌ Wrong: passing QuerySchema.shape — pass inline properties directly
server.registerTool(
  'query_failed_jobs',
  {
    // title: human-readable display name (new in current SDK)
    title: 'Query Failed Jobs',
    // description: CRITICAL — Claude uses this to decide which tool to call
    // Must be precise, specific, non-overlapping with other tools
    description:
      'Query PostgreSQL for failed background jobs within a time range. ' +
      'Use this when the user asks about: job failures, task errors, ' +
      'failed processes, background job status, what went wrong, error patterns.',
    // inputSchema: inline Zod properties — NOT a z.object(), NOT .shape
    inputSchema: {
      time_range: z.enum(['1h', '24h', '7d', '30d']).describe(
        'How far back to look for failed jobs'
      ),
      limit: z.number().int().min(1).max(100).default(20).describe(
        'Maximum number of results to return'
      ),
    },
  },
  async ({ time_range, limit }) => {
    const toolLog = createLogger({ tool: 'query_failed_jobs', time_range });
    toolLog.info('Tool invoked');

    try {
      const intervalMap: Record<string, string> = {
        '1h': '1 hour', '24h': '24 hours',
        '7d': '7 days', '30d': '30 days',
      };

      // ✅ INTERVAL must be cast — pg cannot parameterize INTERVAL directly
      // Use INTERVAL $1 with ::interval cast, or interpolate the safe mapped value
      const rows = await query(
        `SELECT id, name, status, error_message, created_at
         FROM jobs
         WHERE status = 'failed'
           AND created_at > NOW() - $1::interval
         ORDER BY created_at DESC
         LIMIT $2`,
        [intervalMap[time_range], limit]
      );

      toolLog.info({ count: rows.length }, 'Tool completed');
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ jobs: rows, count: rows.length }),
        }],
      };
    } catch (err) {
      toolLog.error({ err }, 'Tool failed');
      // Return error content — don't throw, MCP handles errors via content
      return {
        content: [{
          type: 'text' as const,
          text: `Error querying failed jobs: ${err instanceof Error ? err.message : 'Unknown error'}`,
        }],
        isError: true,
      };
    }
  }
);

// Graceful shutdown — handle both SIGTERM (containers) and SIGINT (Ctrl+C)
async function shutdown() {
  await server.close();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// StdioServerTransport: correct for local servers spawned as child processes
// StreamableHTTPServerTransport: use only for network-accessible remote servers
const transport = new StdioServerTransport();
await server.connect(transport);
log.info('PostgreSQL MCP server running');
```

### Tool Description Rules (Critical — Claude's routing depends on this)
The tool description is the most important code in the project.
Claude uses it to decide which tool to call. Follow these rules:

1. Always include `title` (human display name) AND `description` (Claude routing)
2. `description` must start with the data source: "Query PostgreSQL..." / "Call AWS..."
3. State specifically what it returns
4. List trigger phrases: "Use this when the user asks about: X, Y, Z"
5. Zero overlap with other tool descriptions — if two tools could answer the same
   question, make the distinction explicit in both descriptions

---

## Express API Patterns

See `references/express-patterns.md` for full patterns.

Key rules:
- Always type req/res with generics: `Request<P, ResBody, ReqBody, Query>`
- Centralized error handler middleware — never handle errors inline
- Use AsyncLocalStorage for requestId propagation
- Always validate request body with Zod before using it
- Never trust user input — validate everything at the boundary

---

## Database Patterns (PostgreSQL)

See `references/database-patterns.md` for full patterns.

Key rules:
- Use `pg` with connection pooling — never create single connections
- Always use parameterized queries — never string interpolation in SQL
- Wrap multi-step operations in transactions
- Use `node:crypto` randomUUID() for IDs, not auto-increment where possible
- Always close pool gracefully on process exit

---

## Redis Patterns

Key rules:
- Use `ioredis` not the `redis` package (better TypeScript support)
- Always set TTL on cached values — never cache without expiry
- Use consistent key naming: `service:entity:id` e.g. `copilot:jobs:failed:24h`
- Gracefully handle Redis connection failures — Redis down should not crash the app

---

## AWS SDK Patterns (v3)

Key rules:
- Always use AWS SDK v3 (modular) — never v2
- Import only the specific client needed — never import the whole SDK
- Always configure region from env
- Use exponential backoff for retries — SDK does this by default

```typescript
import { CostExplorerClient, GetCostAndUsageCommand } from '@aws-sdk/client-cost-explorer';
import { env } from '../config/env.js';

const costClient = new CostExplorerClient({ region: env.AWS_REGION });

// Always wrap in try/catch and throw typed errors
try {
  const response = await costClient.send(new GetCostAndUsageCommand(params));
  return response;
} catch (err) {
  throw new AppError('AWS Cost Explorer request failed', 'AWS_ERROR', 500, { cause: err });
}
```

---

## Project Structure

```
src/
├── config/
│   └── env.ts                    # Zod env validation — loaded first
├── errors/
│   └── index.ts                  # Custom error classes
├── lib/
│   ├── logger.ts                 # Pino logger
│   ├── database.ts               # PostgreSQL pool
│   └── redis.ts                  # ioredis client
├── mcp-servers/
│   ├── postgres-server.ts        # Standalone MCP process — query_failed_jobs tool
│   ├── redis-server.ts           # Standalone MCP process — get_redis_stats tool
│   └── aws-server.ts             # Standalone MCP process — get_aws_costs tool
├── orchestrator/
│   ├── index.ts                  # Express app + middleware + requestId
│   ├── claude.ts                 # Claude API agentic loop
│   ├── tools.ts                  # Tool definitions array passed to Claude API
│   ├── tool-dispatcher.ts        # Routes Claude tool calls to implementations
│   └── routes/
│       └── chat.ts               # POST /api/chat route handler
├── models/
│   └── job.ts                    # Row type interfaces
└── index.ts                      # Entry point + graceful shutdown
```

---

## Testing

Use Vitest (consistent with Angular frontend).

```typescript
import { describe, it, expect, vi } from 'vitest';

describe('query_failed_jobs tool', () => {
  it('should return failed jobs within time range', async () => {
    const mockQuery = vi.fn().mockResolvedValue([{ id: '1', status: 'failed' }]);
    const result = await queryFailedJobs({ time_range: '24h', limit: 10 }, mockQuery);
    expect(result.content[0].type).toBe('text');
    expect(JSON.parse(result.content[0].text as string).count).toBe(1);
  });

  it('should return isError:true on DB failure', async () => {
    // MCP tools return errors — they do NOT throw
    // Throwing breaks the MCP protocol — always return { isError: true }
    const mockQuery = vi.fn().mockRejectedValue(new Error('DB down'));
    const result = await queryFailedJobs({ time_range: '24h', limit: 10 }, mockQuery);
    expect(result.isError).toBe(true);
    expect(result.content[0].type).toBe('text');
  });
});
```

---

## Code Generation Checklist

When generating any Node.js code, verify:

- [ ] ESM imports with `node:` prefix for built-ins
- [ ] `"type": "module"` assumed in package.json
- [ ] Strict TypeScript — no `any`, no loose types
- [ ] tsx for dev scripts, tsc for build
- [ ] Env vars validated with Zod at startup
- [ ] Custom error classes with `cause`
- [ ] Pino logger — no console.log
- [ ] Parameterized DB queries — no string interpolation
- [ ] Zod validation on all external inputs
- [ ] AWS SDK v3 modular imports only
- [ ] MCP tool descriptions precise and non-overlapping
- [ ] Graceful shutdown handling (SIGTERM, SIGINT)

## Reference Files

- **`references/express-patterns.md`** — Express API patterns, middleware, error handling, requestId
- **`references/database-patterns.md`** — PostgreSQL pool, transactions, migrations, query patterns
- **`references/mcp-patterns.md`** — MCP server setup, tool design, Claude API integration, streaming
