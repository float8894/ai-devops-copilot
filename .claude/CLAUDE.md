# AI DevOps Copilot — Claude Code Instructions

This file is read automatically by Claude Code (`claude`) and GitHub Copilot
(via `.github/copilot-instructions.md` symlink). It defines the authoritative
coding standards for this project. Follow every rule here exactly — do not
infer from general knowledge when a rule is stated explicitly.

---

## What this project is

A conversational AI infrastructure copilot. Engineers ask plain-English questions
like "why did costs spike Tuesday?" and get a single intelligent answer drawn from
PostgreSQL, Redis, and AWS Cost Explorer. The AI layer is Claude API with tool use
in an agentic loop. Three standalone MCP servers expose the data sources as tools.

---

## Stack — never deviate from this

| Layer | Technology | Notes |
|-------|-----------|-------|
| Runtime | Node.js 24 | ESM only, `node:` prefix for built-ins |
| Language | TypeScript strict | No `any`, no loose types |
| Framework | Express (no NestJS) | Typed req/res generics always |
| Dev runner | `tsx` | Never `ts-node` |
| Build | `tsc` | `NodeNext` module resolution |
| MCP | `@modelcontextprotocol/sdk@^1` | v1 stable — NOT v2 split packages |
| AI | `@anthropic-ai/sdk` | `claude-sonnet-4-20250514` |
| DB | PostgreSQL via `pg` pool | Parameterized queries only |
| Cache | Redis via `ioredis` | Never the `redis` package |
| AWS | SDK v3 modular | Never v2, never full SDK import |
| Validation | `zod` | Every external input boundary |
| Logging | `pino` + `pino-pretty` | Never `console.log` anywhere in `src/` |
| Testing | `vitest` | |
| Env | Native `--env-file` | No `dotenv` package |

---

## Node.js rules — enforce on every file

### Imports
```typescript
// ✅ Always — node: prefix for built-ins
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

// ❌ Never
import fs from 'fs';
const crypto = require('crypto');
```

### TypeScript
- `"strict": true` — always
- No `any` — use `unknown` for truly uncertain types
- Use `satisfies` over type assertions (`as`) wherever possible
- `noUncheckedIndexedAccess: true` — always handle the `T | undefined` case
- `exactOptionalPropertyTypes: true` — don't set optional props to `undefined` explicitly

### Error handling
```typescript
// ✅ Always — custom classes with cause
throw new DatabaseError('Query failed', err);   // cause chained automatically

// ❌ Never
throw new Error('something broke');
throw 'string error';
```

Custom error hierarchy lives in `src/errors/index.ts`:
- `AppError` (base) → `DatabaseError`, `McpToolError`, `ValidationError`

### Logging
```typescript
// ✅ Always
import { createLogger } from '../lib/logger.js';
const log = createLogger({ service: 'mcp-postgres', tool: 'query_failed_jobs' });
log.info({ timeRange }, 'Tool invoked');
log.error({ err }, 'Tool failed');

// ❌ Never — anywhere in src/
console.log(...)
console.error(...)
```

### Async
- Always `async/await` — no callbacks, no `.then()` chains
- `Promise.all` for parallel independent operations
- `Promise.allSettled` when partial failure is acceptable

### Database
```typescript
// ✅ Always — parameterized
await query('SELECT * FROM jobs WHERE status = $1 AND created_at > NOW() - $2::interval',
  ['failed', '24 hours']);

// ❌ Never — SQL injection risk
await db.query(`SELECT * FROM jobs WHERE status = '${status}'`);
```

Note: PostgreSQL cannot parameterize `INTERVAL` directly — always use `$n::interval` cast.

### Env vars
- Validated with Zod at startup in `src/config/env.ts`
- If any var is missing, the process exits immediately with a clear error
- Loaded via `node --env-file=.env` — no `dotenv` package

---

## MCP server rules

Each MCP server is a **standalone Node.js process** — one file, one `McpServer` instance.
Never share an MCP server instance across processes.

```typescript
// ✅ Correct API — registerTool with inline Zod properties
server.registerTool('tool_name', {
  title: 'Human Display Name',
  description: 'Data source: PostgreSQL. Returns X. Use when user asks about: Y, Z.',
  inputSchema: {
    time_range: z.enum(['1h', '24h']).describe('...'),
  },
}, async ({ time_range }) => { ... });

// ❌ Wrong — old API, removed
server.tool(...)

// ❌ Wrong — don't pass .shape or a z.object()
inputSchema: QuerySchema.shape
inputSchema: z.object({ ... })
```

### Tool description rules (CRITICAL — Claude routes tool calls by description)

Every tool description MUST follow this format:
1. Start with the data source: `"Query PostgreSQL..."` / `"Call AWS Cost Explorer..."`
2. State specifically what it returns
3. End with trigger phrases: `"Use this when the user asks about: X, Y, Z"`
4. Zero overlap with other tool descriptions

Current tools and their non-overlapping domains:
- `query_failed_jobs` → PostgreSQL jobs table, failures/errors/task status
- `get_redis_stats` → Redis INFO command, cache metrics/hit rate/memory
- `get_aws_costs` → AWS Cost Explorer API, billing/spend/cost spikes

### MCP error handling
MCP tool handlers must **never throw**. Return `{ isError: true }` instead:
```typescript
// ✅ Return errors — never throw in a tool handler
return {
  content: [{ type: 'text' as const, text: `Error: ${err.message}` }],
  isError: true,
};
```

### Transport
- `StdioServerTransport` — for local servers spawned as child processes (this project)
- `StreamableHTTPServerTransport` — only for network-accessible remote servers

---

## Express rules

- Always type req/res with generics: `Request<Params, ResBody, ReqBody, Query>`
- Centralized error handler middleware — never handle errors inline in route handlers
- `AsyncLocalStorage` for `requestId` propagation across the async call stack
- Validate every request body with Zod before touching `req.body`
- CORS configured for `http://localhost:4200` in development

---

## AWS rules

```typescript
// ✅ Always — v3 modular, single client
import { CostExplorerClient, GetCostAndUsageCommand } from '@aws-sdk/client-cost-explorer';

// ❌ Never — v2 or full import
import AWS from 'aws-sdk';
import { CostExplorer } from '@aws-sdk/client-cost-explorer'; // wrong export
```

---

## Claude API agentic loop rules

Model to use:
- `claude-sonnet-4-20250514` — production demos
- `claude-haiku-4-5-20251001` — development (saves cost)

The agentic loop in `src/orchestrator/claude.ts` MUST:
1. Guard against `stop_reason !== 'tool_use'` to prevent infinite loops
2. Push assistant messages AND tool results into `messages[]` on every iteration
3. Never truncate `response.content` when building the assistant message

---

## File structure — never add files outside these directories

```
src/
├── config/env.ts                        # Zod env schema — loaded first
├── errors/index.ts                      # AppError hierarchy
├── lib/logger.ts                        # Pino
├── lib/database.ts                      # pg pool + query helper + withTransaction
├── lib/redis.ts                         # ioredis client
├── mcp-servers/postgres-server.ts       # Standalone MCP — query_failed_jobs
├── mcp-servers/redis-server.ts          # Standalone MCP — get_redis_stats
├── mcp-servers/aws-server.ts            # Standalone MCP — get_aws_costs
├── models/job.ts                        # Row type interfaces
├── orchestrator/index.ts                # Express app
├── orchestrator/claude.ts               # Claude API agentic loop
├── orchestrator/tools.ts                # Tool definitions for Claude API
├── orchestrator/tool-dispatcher.ts      # Routes tool calls to implementations
├── orchestrator/routes/chat.ts          # POST /api/chat
└── index.ts                             # Entry point + graceful shutdown
```

---

## Testing rules

- Framework: Vitest (NOT Jest)
- MCP tool tests: inject a mock `query` function — never hit a real DB in unit tests
- Tool handler tests: must verify `isError: true` path — tools return errors, never throw
- Coverage target: every tool handler, every error branch

```typescript
// ✅ Correct test pattern for MCP tools
it('should return isError:true on DB failure', async () => {
  const mockQuery = vi.fn().mockRejectedValue(new Error('DB down'));
  const result = await queryFailedJobs({ time_range: '24h', limit: 10 }, mockQuery);
  expect(result.isError).toBe(true);
});
```

---

## Checklist — run mentally before every file you generate

### Node.js
- [ ] ESM imports with `node:` prefix for built-ins
- [ ] `"type": "module"` in package.json
- [ ] Strict TypeScript — no `any`
- [ ] `tsx` for dev, `tsc` for build
- [ ] Zod env validation at startup
- [ ] Custom error classes with `cause`
- [ ] Pino — no `console.log`
- [ ] Parameterized SQL — no string interpolation
- [ ] AWS SDK v3 modular only
- [ ] MCP `registerTool()` — not `tool()`
- [ ] Tool descriptions: data source prefix + trigger phrases
- [ ] Graceful shutdown: `SIGTERM` + `SIGINT`
- [ ] MCP handlers return `{ isError: true }` — never throw

---

## Common mistakes — never do these

| Wrong | Right |
|-------|-------|
| `import fs from 'fs'` | `import fs from 'node:fs/promises'` |
| `console.log(...)` | `log.info(...)` |
| `throw new Error(msg)` | `throw new DatabaseError(msg, err)` |
| `server.tool(...)` | `server.registerTool(...)` |
| `inputSchema: Schema.shape` | `inputSchema: { field: z.string() }` |
| `ts-node src/index.ts` | `tsx src/index.ts` |
| `import AWS from 'aws-sdk'` | `import { CostExplorerClient } from '@aws-sdk/client-cost-explorer'` |
| `require('dotenv').config()` | `node --env-file=.env` |
| SQL: `` `WHERE id = '${id}'` `` | `WHERE id = $1` with `[id]` params |
| `process.env.PORT` (unvalidated) | `env.PORT` from `src/config/env.ts` |
