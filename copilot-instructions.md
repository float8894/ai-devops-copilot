# GitHub Copilot Instructions — AI DevOps Copilot

This file configures GitHub Copilot for this repository. Copilot must follow
every rule here when generating or completing code.

> These instructions mirror `.claude/CLAUDE.md`. If they ever conflict,
> `.claude/CLAUDE.md` is the authoritative source.

---

## Project overview

Conversational AI infrastructure copilot. Backend: Node.js 24 + TypeScript +
Express + MCP servers. Three MCP servers expose PostgreSQL, Redis, and AWS
Cost Explorer as tools to a Claude API agentic loop. Angular 21 frontend (separate workspace).

---

## Non-negotiable rules

### 1. ESM + node: prefix — always

```typescript
// 
import { randomUUID } from 'node:crypto';
import { readFile }   from 'node:fs/promises';
import path           from 'node:path';

//  Never
const fs = require('fs');
import fs from 'fs';
```

### 2. No console.log — ever

Use Pino structured logging everywhere in `src/`:

```typescript
import { createLogger } from '../lib/logger.js';
const log = createLogger({ service: 'my-service' });
log.info({ data }, 'descriptive message');
log.error({ err }, 'what failed');
```

### 3. No any — ever

```typescript
// 
function process(input: unknown): string { ... }

// 
function process(input: any): any { ... }
```

### 4. Custom errors with cause — always

```typescript
// 
throw new DatabaseError('Query failed', err);

// 
throw new Error('Query failed');
throw err;
```

### 5. Parameterized SQL — always

```typescript
// 
await query('SELECT * FROM jobs WHERE status = $1', ['failed']);

//  SQL injection
await db.query(`SELECT * FROM jobs WHERE status = '${status}'`);
```

Note: INTERVAL requires a cast: `$1::interval` not just `$1`.

### 6. MCP SDK — registerTool, not tool()

```typescript
// 
server.registerTool('name', { title, description, inputSchema: { field: z.string() } }, handler);

//  Old API — removed
server.tool('name', schema, handler);
```

`inputSchema` takes **inline Zod property definitions** — not `Schema.shape`, not `z.object(...)`.

### 7. MCP handlers never throw

```typescript
//  Return error content
return {
  content: [{ type: 'text' as const, text: `Error: ${err.message}` }],
  isError: true,
};

//  Never throw inside a tool handler
throw err;
```

### 8. AWS SDK v3 modular — always

```typescript
// 
import { CostExplorerClient, GetCostAndUsageCommand } from '@aws-sdk/client-cost-explorer';

// 
import AWS from 'aws-sdk';
```

### 9. Zod validation at every input boundary

Every Express route validates `req.body` with Zod before touching it.
Every env var is validated at startup in `src/config/env.ts`.

### 10. tsx for dev, tsc for build — never ts-node

```bash
# 
npm run dev     # uses tsx watch
npm run build   # uses tsc

# 
npx ts-node src/index.ts
```

---

## File-by-file expectations

When Copilot suggests code in these files, apply the specific rule:

| File | Key rule |
|------|----------|
| `src/config/env.ts` | Zod schema, `envSchema.parse(process.env)`, fail-fast |
| `src/errors/index.ts` | `AppError` base, subclasses with `cause` in constructor |
| `src/lib/logger.ts` | `pino()` instance, `createLogger(ctx)` helper, no console |
| `src/lib/database.ts` | `pg.Pool`, typed `query<T>()` helper, `withTransaction()` |
| `src/lib/redis.ts` | `ioredis`, `lazyConnect: true`, error event handler |
| `src/mcp-servers/*.ts` | `registerTool()`, inline Zod inputSchema, return `isError` |
| `src/orchestrator/claude.ts` | Guard `stop_reason`, push messages every iteration |
| `src/orchestrator/tools.ts` | `Anthropic.Tool[]`, data-source prefix in description |
| `src/orchestrator/routes/chat.ts` | Zod parse req.body, typed `Request<>` generics, `next(err)` |

---

## Patterns to always suggest

### Async parallel work
```typescript
const [costData, jobData] = await Promise.all([
  getAwsCosts(range),
  queryFailedJobs(range),
]);
```

### Graceful shutdown
```typescript
async function shutdown(signal: string) {
  log.info({ signal }, 'Shutdown initiated');
  server.close(async () => {
    await db.end();
    await redis.quit();
    process.exit(0);
  });
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
```

### Express route — always typed + Zod + next(err)
```typescript
router.post('/', async (
  req: Request<object, ResponseType, RequestBodyType>,
  res: Response<ResponseType>,
  next: NextFunction
) => {
  try {
    const body = BodySchema.safeParse(req.body);
    if (!body.success) throw new ValidationError('Invalid body', body.error);
    const result = await doWork(body.data);
    res.json(result);
  } catch (err) {
    next(err); // always — never respond inline on error
  }
});
```

---

## Patterns to never suggest

- `require()` or CommonJS exports
- `console.log / console.error / console.warn`
- `ts-node` in any script
- `dotenv` package
- `aws-sdk` v2
- `@modelcontextprotocol/sdk` v2 split packages
- `server.tool()` (old MCP API)
- `z.object(...)` or `Schema.shape` in `inputSchema`
- Throwing inside MCP tool handlers
- String interpolation in SQL
- Unvalidated `process.env` access
- `BehaviorSubject` for local state (Angular side)
- `*ngIf` / `*ngFor` structural directives (Angular side)
- Constructor injection (Angular side)
