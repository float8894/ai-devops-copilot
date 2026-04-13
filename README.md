# AI DevOps Copilot

A conversational AI infrastructure monitoring tool. Ask plain-English questions like _"why did costs spike on Tuesday?"_ or _"are there any failed jobs in the last 24 hours?"_ and get a single intelligent answer drawn from PostgreSQL, Redis, and AWS Cost Explorer.

Built to demonstrate production-grade agentic AI engineering — Claude reasons across multiple live data sources using an agentic tool loop, decides which tools to call (and in what order), and synthesizes all results into one coherent response.

---

## How it works

```
User question
     │
     ▼
Express API  ──►  Claude Sonnet (Anthropic)
                       │
           ┌───────────┼───────────┐
           ▼           ▼           ▼
     MCP Server   MCP Server   MCP Server
     (Postgres)    (Redis)      (AWS)
           │           │           │
           ▼           ▼           ▼
      PostgreSQL     Redis    Cost Explorer
      failed jobs   INFO cmd   spend data
           │           │           │
           └───────────┴───────────┘
                       │
                       ▼
              Single synthesized reply
```

1. The user sends a message to `POST /api/chat`
2. The Express orchestrator passes it to the Claude agentic loop
3. Claude inspects its three tools and decides which to call
4. Each tool is backed by a standalone **MCP server** — separate Node.js processes communicating over stdio
5. Claude receives the tool results, reasons across them, and returns one answer

---

## Tech stack

| Layer         | Technology                                                    |
| ------------- | ------------------------------------------------------------- |
| Runtime       | Node.js 24 (ESM)                                              |
| Language      | TypeScript 5 — strict mode, no `any`                          |
| API framework | Express 5                                                     |
| AI model      | `claude-sonnet-4-6` via `@anthropic-ai/sdk`                   |
| Tool protocol | Model Context Protocol (MCP) — `@modelcontextprotocol/sdk@^1` |
| Database      | PostgreSQL 16 via `pg` pool                                   |
| Cache         | Redis 7 via `ioredis`                                         |
| Cloud costs   | AWS SDK v3 — `@aws-sdk/client-cost-explorer`                  |
| Validation    | Zod                                                           |
| Logging       | Pino + pino-pretty                                            |
| Testing       | Vitest                                                        |
| Dev runner    | `tsx`                                                         |

---

## Project structure

```
ai-devops-copilot/
├── backend/
│   ├── src/
│   │   ├── config/env.ts                   # Zod env validation — exits on missing vars
│   │   ├── errors/index.ts                 # AppError hierarchy (Database, Mcp, Validation)
│   │   ├── lib/
│   │   │   ├── database.ts                 # pg pool + parameterized query helper
│   │   │   ├── redis.ts                    # ioredis client
│   │   │   └── logger.ts                   # Pino structured logger factory
│   │   ├── mcp-servers/
│   │   │   ├── postgres-server.ts          # MCP tool: query_failed_jobs
│   │   │   ├── redis-server.ts             # MCP tool: get_redis_stats
│   │   │   └── aws-server.ts               # MCP tool: get_aws_costs
│   │   ├── models/job.ts                   # TypeScript row/stat interfaces
│   │   ├── orchestrator/
│   │   │   ├── claude.ts                   # Agentic loop — calls Claude, dispatches tools
│   │   │   ├── tools.ts                    # Anthropic tool definitions
│   │   │   ├── tool-dispatcher.ts          # Routes Claude tool calls to MCP servers
│   │   │   ├── index.ts                    # Express app factory
│   │   │   ├── middleware/error-handler.ts # Centralized error handler
│   │   │   └── routes/chat.ts              # POST /api/chat
│   │   └── index.ts                        # Entry point + graceful shutdown
│   ├── docker/init.sql                     # Seed schema (jobs table)
│   ├── docker-compose.yml                  # PostgreSQL + Redis
│   └── package.json
└── frontend/                               # Angular 21 (in progress)
```

---

## Key design decisions

### Agentic tool loop

The Claude loop in `orchestrator/claude.ts` runs until `stop_reason === 'end_turn'`. A guard breaks the loop on any other unexpected stop reason to prevent infinite spinning. Both assistant messages and tool results are pushed into `messages[]` on every iteration so Claude maintains full context.

### MCP servers as standalone processes

Each data source is a separate Node.js process communicating over `StdioServerTransport`. This matches the MCP spec and keeps concerns isolated — the orchestrator never touches PostgreSQL or Redis directly.

### Tool descriptions drive routing

Claude has no hard-coded routing logic. It picks tools purely from their descriptions. Each description starts with the data source, states exactly what it returns, and ends with unambiguous trigger phrases to prevent overlap.

### No `any`, no implicit unknowns

Strict TypeScript throughout — `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`. Redis INFO output is parsed from raw strings; PostgreSQL results flow through typed row interfaces.

---

## Getting started

### Prerequisites

- Node.js ≥ 24
- Docker + Docker Compose
- An Anthropic API key
- AWS credentials with `ce:GetCostAndUsage` read permission

### 1. Clone and install

```bash
git clone https://github.com/your-username/ai-devops-copilot.git
cd ai-devops-copilot/backend
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env`:

```env
NODE_ENV=development
PORT=3000

DATABASE_URL=postgresql://copilot:copilot_dev@localhost:5432/copilot_db
REDIS_URL=redis://localhost:6379

ANTHROPIC_API_KEY=sk-ant-...

AWS_REGION=us-east-1
```

### 3. Start infrastructure

```bash
docker compose up -d
```

This starts PostgreSQL 16 and Redis 7. The `docker/init.sql` seed creates the `jobs` table and inserts sample failed jobs.

### 4. Run the server

```bash
npm run dev
```

---

## API

### `POST /api/chat`

Send a natural language question about your infrastructure.

**Request**

```json
{
  "message": "Why did costs spike this week and are there any related job failures?"
}
```

**Response**

```json
{
  "reply": "AWS costs increased 34% this week, driven primarily by EC2 (+$240). In the same period, 12 jobs failed with 'ConnectionTimeout' errors — these are likely related: the EC2 spend spike coincides with auto-scaling events triggered by the retry storms from the failing jobs.",
  "toolsUsed": ["get_aws_costs", "query_failed_jobs"]
}
```

**Example questions**

- `"How many jobs failed in the last hour?"`
- `"What's our Redis cache hit rate?"`
- `"Which AWS service is costing the most this month?"`
- `"Is anything wrong with the infrastructure right now?"`

---

## Running MCP servers individually

Each MCP server can be run standalone for testing:

```bash
npm run mcp:postgres   # Exposes query_failed_jobs
npm run mcp:redis      # Exposes get_redis_stats
npm run mcp:aws        # Exposes get_aws_costs
```

---

## Tests

```bash
npm run test        # Watch mode
npm run test:run    # Single run
npm run typecheck   # TypeScript only, no emit
```

Tests use Vitest with injected mock query functions — no real database connections in unit tests. Every tool handler has coverage for the `isError: true` path (tools return errors, they never throw).

---

## Security notes

- All SQL uses parameterized queries — no string interpolation
- Env vars are validated with Zod at startup; the process exits immediately if any are missing
- `helmet` sets security headers on all Express responses
- CORS is restricted to `localhost:4200` in development
- The `@types/node` package is scoped to devDependencies; production types are inferred from the strict schema

---

## License

MIT
