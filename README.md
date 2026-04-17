# AI DevOps Copilot

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-24-green.svg)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue.svg)](https://typescriptlang.org)

A conversational AI infrastructure monitoring tool. Ask plain-English questions like _"why did costs spike on Tuesday?"_ or _"are there any failed jobs in the last 24 hours?"_ and get a single intelligent answer drawn from PostgreSQL, Redis, and AWS Cost Explorer.

Built to demonstrate **production-grade agentic AI engineering** — Claude reasons across multiple live data sources using an agentic tool loop, decides which tools to call (and in what order), and synthesizes all results into one coherent response.

> ** NEW:** Multi-turn conversations with full history persistence, rate limiting, and enhanced security. See [IMPROVEMENTS.md](backend/IMPROVEMENTS.md) for details.

---

## How it works

```
User question
     │
     ▼
Express API  ──►  Claude Sonnet 4.6 (Anthropic)
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

### The flow:

1. User sends a message to `POST /api/chat` (optionally with `conversationId`)
2. Express orchestrator loads conversation history from PostgreSQL
3. Claude receives full context and decides which tools to call
4. Each tool is backed by a standalone **MCP server** — separate Node.js processes communicating over stdio
5. Claude receives the tool results, reasons across them, and returns one answer
6. Both user message and Claude response are saved to PostgreSQL for future context

**Key insight:** Claude has no hard-coded routing logic. It picks tools purely from their descriptions. Each description is crafted to be precise, specific, and non-overlapping — this is the most critical code in the project.

---

## Tech stack

| Layer             | Technology                                                         |
| ----------------- | ------------------------------------------------------------------ |
| **Runtime**       | Node.js 24 (ESM modules, native `--env-file` flag)                 |
| **Language**      | TypeScript 6 — strict mode, no `any`, `exactOptionalPropertyTypes` |
| **API**           | Express 5 + express-rate-limit                                     |
| **AI Model**      | `claude-sonnet-4-6` (via `@anthropic-ai/sdk`)                      |
| **Tool Protocol** | Model Context Protocol (MCP) — `@modelcontextprotocol/sdk@^1`      |
| **Database**      | PostgreSQL 16 (via `pg` pool with parameterized queries)           |
| **Cache**         | Redis 7 (via `ioredis`)                                            |
| **Cloud Costs**   | AWS SDK v3 modular — `@aws-sdk/client-cost-explorer`               |
| **Validation**    | Zod (env vars + request bodies)                                    |
| **Logging**       | Pino + pino-pretty (structured JSON logs)                          |
| **Testing**       | Vitest (integration tests against real PostgreSQL)                 |
| **Dev Runner**    | `tsx` (never `ts-node`)                                            |
| **Frontend**      | Angular 21 with signals, zoneless, standalone components (WIP)     |

---

## Project structure

```
ai-devops-copilot/
├── backend/
│   ├── src/
│   │   ├── config/
│   │   │   └── env.ts                      # Zod env validation — exits on missing vars
│   │   ├── errors/
│   │   │   └── index.ts                    # AppError hierarchy (Database, Mcp, Validation)
│   │   ├── lib/
│   │   │   ├── database.ts                 # pg pool + query helper + withTransaction
│   │   │   ├── database.test.ts            # Vitest integration tests
│   │   │   ├── redis.ts                    # ioredis client
│   │   │   └── logger.ts                   # Pino structured logger factory
│   │   ├── services/
│   │   │   └── conversation.service.ts     #  Conversation history management
│   │   ├── mcp-servers/
│   │   │   ├── postgres-server.ts          # MCP tool: query_failed_jobs
│   │   │   ├── redis-server.ts             # MCP tool: get_redis_stats
│   │   │   └── aws-server.ts               # MCP tool: get_aws_costs
│   │   ├── models/
│   │   │   └── job.ts                      # TypeScript row/stat interfaces
│   │   ├── orchestrator/
│   │   │   ├── claude.ts                   # Agentic loop — calls Claude, dispatches tools
│   │   │   ├── tools.ts                    # Anthropic tool definitions for Claude API
│   │   │   ├── tool-dispatcher.ts          # Routes Claude tool calls to implementations
│   │   │   ├── index.ts                    # Express app factory + middleware
│   │   │   ├── middleware/
│   │   │   │   ├── error-handler.ts        # Centralized error handler
│   │   │   │   └── rate-limit.ts           #  Rate limiting middleware
│   │   │   └── routes/
│   │   │       └── chat.ts                 # POST /api/chat endpoint
│   │   └── index.ts                        # Entry point + graceful shutdown
│   ├── docker/
│   │   ├── init.sql                        # Seed schema (jobs + conversations + messages)
│   │   └── migrations/
│   │       └── 001_add_conversations.sql   #  Migration for existing databases
│   ├── docker-compose.yml                  # PostgreSQL + Redis
│   ├── package.json
│   ├── tsconfig.json
│   ├── SETUP.md                            # Complete setup guide
│   ├── IMPROVEMENTS.md                     #  New features documentation
│   └── INSTALL_IMPROVEMENTS.md             #  Installation guide for updates
└── frontend/                               # Angular 21 (in progress)
```

---

## What's New (Latest Updates)

### Conversation History Persistence

- Multi-turn conversations with full context
- PostgreSQL-backed storage (conversations + messages tables)
- Claude references previous turns: _"As we discussed earlier..."_
- Automatic conversation creation or continuation

### Rate Limiting

- Chat endpoint: 20 req/15min (prod) / 100 req/15min (dev)
- General API: 100 req/15min (prod) / 500 req/15min (dev)
- Standard RateLimit-\* headers
- `/health` endpoint excluded

### Enhanced Security

- Request size limit reduced: 1mb → 10kb (prevents DoS)
- UUID-based conversation IDs (non-enumerable)
- Indexed database queries (<10ms even with 1000+ messages)

**See [IMPROVEMENTS.md](backend/IMPROVEMENTS.md) for complete documentation.**

---

## Key design decisions

### 1. Agentic tool loop

The Claude loop in `orchestrator/claude.ts` runs **until `stop_reason === 'end_turn'`**. A safety guard breaks the loop on any unexpected stop reason to prevent infinite spinning. Both assistant messages and tool results are pushed into `messages[]` on every iteration so Claude maintains full context across multiple tool calls.

### 2. Conversation persistence

Every conversation is stored in PostgreSQL with full message history. When a user continues a conversation (by providing `conversationId`), the entire history is loaded and passed to Claude API. This enables:

- Context-aware responses across multiple turns
- Claude referencing previous answers
- Conversation analytics and debugging
- Future features like conversation export and sharing

### 3. MCP servers as standalone processes

Each data source is a **separate Node.js process** communicating over `StdioServerTransport`. This matches the MCP spec and keeps concerns isolated — the orchestrator never touches PostgreSQL or Redis directly. Each server can be run independently for testing:

```bash
npm run mcp:postgres  # Exposes query_failed_jobs tool
npm run mcp:redis     # Exposes get_redis_stats tool
npm run mcp:aws       # Exposes get_aws_costs tool
```

### 4. Tool descriptions drive routing

Claude has **no hard-coded routing logic**. It picks tools purely from their descriptions. Each description:

- Starts with the data source explicitly: _"Query PostgreSQL..."_, _"Call AWS..."_
- States exactly what it returns
- Ends with unambiguous trigger phrases to prevent overlap
- Is tested to ensure zero ambiguity between tools

**This is the most critical code in the project** — poor tool descriptions cause Claude to route incorrectly.

### 5. Multi-tier rate limiting

Rate limiting is applied at two levels:

- **Chat endpoint:** Stricter limits (20/15min prod) because Claude API calls are expensive
- **General API:** Relaxed limits (100/15min prod) for health checks and metadata
- Automatically adjusts based on `NODE_ENV`

### 6. Strict TypeScript everywhere

- `noUncheckedIndexedAccess`: Array access returns `T | undefined`
- `exactOptionalPropertyTypes`: `{ x?: string }` cannot be set to `undefined`
- No `any` anywhere — use `unknown` for truly uncertain types
- Redis INFO output is parsed from raw strings with proper error handling
- PostgreSQL results flow through typed row interfaces

### 7. Parameterized queries only

All SQL uses **parameterized queries** — no string interpolation anywhere. PostgreSQL `INTERVAL` requires `::interval` cast when parameterized:

```typescript
//  Correct
await query(`SELECT * FROM jobs WHERE created_at > NOW() - $1::interval`, [
  '24 hours',
]);

//  SQL injection risk
await query(`SELECT * FROM jobs WHERE created_at > NOW() - '${timeRange}'`);
```

---

## Getting started

### Prerequisites

- **Node.js ≥ 24**
- **Docker + Docker Compose**
- **Anthropic API key** (get from https://console.anthropic.com)
- **AWS credentials** with `ce:GetCostAndUsage` read permission

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

Edit `.env` with your credentials:

```env
NODE_ENV=development
PORT=3000
DATABASE_URL=postgresql://copilot:copilot_dev@localhost:5432/copilot_db
REDIS_URL=redis://localhost:6379
ANTHROPIC_API_KEY=sk-ant-...
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=...
ALLOWED_ORIGIN=http://localhost:4200
```

### 3. Start infrastructure

```bash
docker compose up -d
```

This starts:

- **PostgreSQL 16** on `:5432` (auto-seeds with `docker/init.sql`)
- **Redis 7** on `:6379`

Verify both are healthy:

```bash
docker compose ps
# NAME               STATUS
# copilot_postgres   Up (healthy)
# copilot_redis      Up (healthy)
```

### 4. Run the server

```bash
npm run dev
```

Server starts on http://localhost:3000 with hot reload.

---

## API

### `POST /api/chat`

Send a natural language question about your infrastructure.

**Request:**

```json
{
  "message": "Why did costs spike this week and are there any related job failures?",
  "conversationId": "optional-uuid-from-previous-response"
}
```

**Response:**

```json
{
  "reply": "AWS costs increased 34% this week, driven primarily by EC2 (+$240). In the same period, 12 jobs failed with 'ConnectionTimeout' errors — these are likely related: the EC2 spend spike coincides with auto-scaling events triggered by the retry storms from the failing jobs.",
  "toolsUsed": ["get_aws_costs", "query_failed_jobs"],
  "conversationId": "abc-123-def-456"
}
```

**Multi-turn Conversation Example:**

```bash
# First message
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "How many jobs failed in the last hour?"}'

# Response includes conversationId: "abc-123-def-456"

# Continue conversation
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "What about Redis cache?", "conversationId": "abc-123-def-456"}'

# Claude now has full context from previous message
```

### Example questions

```
"How many jobs failed in the last hour?"
"What's our Redis cache hit rate?"
"Which AWS service is costing the most this month?"
"Is anything wrong with the infrastructure right now?"
"Show me failed jobs and current cache performance"
"What did we discuss about costs last time?" (multi-turn)
```

---

## Tests

Run integration tests (requires Docker running):

```bash
npm run test        # Watch mode
npm run test:run    # Single run
npm run typecheck   # TypeScript type-check only
```

Tests use **Vitest** with real PostgreSQL connections. Test data is prefixed with `vitest-` and cleaned up in `beforeAll` / `afterAll` hooks.

**Key test coverage:**

- Parameterized query helper with type safety
- INTERVAL cast handling in time range queries
- Error grouping pattern used by MCP tools
- Database connection cleanup

---

## Security notes

- All SQL uses parameterized queries — zero string interpolation
- Env vars validated with Zod at startup; process exits if any are missing
- `helmet` sets security headers on all Express responses
- CORS restricted to `localhost:4200` in development, configurable for production
- No `any` types — strict TypeScript prevents type confusion bugs
- Structured logging with Pino — no `console.log` anywhere in production code
- **NEW:** Rate limiting prevents brute force and DDoS attacks
- **NEW:** 10kb request size limit prevents memory exhaustion
- **NEW:** UUID-based conversation IDs prevent enumeration

---

## Architecture highlights

### Why MCP protocol?

The Model Context Protocol (MCP) is Anthropic's standard for connecting LLMs to external tools. By implementing MCP servers:

- Each data source is independently testable
- Tools can be reused across different Claude clients
- The orchestrator stays thin — it just routes tool calls
- Servers can be deployed separately (microservices architecture)

### Why three separate MCP servers?

PostgreSQL, Redis, and AWS are **isolated concerns**. Each server:

- Has its own connection pool/client
- Handles its own errors
- Can be scaled independently
- Can be tested in isolation

### Why tool descriptions matter so much

Claude decides which tool to call **purely from text descriptions**. There's no code like `if (question.includes('cost')) return awsTool()`. Instead, Claude reads:

> _"Query AWS Cost Explorer for cloud spending data... Use this when the user asks about: AWS costs, cloud spend, billing..."_

If two tool descriptions overlap, Claude picks randomly. If a description is vague, Claude might not call it when it should. **Tool descriptions are prompts** — they need the same care as any other LLM prompt.

### Why conversation persistence matters

Without persistence, every message starts from scratch. With persistence:

- Claude understands follow-up questions: _"What about the previous month?"_
- Users can continue conversations later
- Debugging is easier (full conversation history in database)
- Future analytics and export features become possible

---

## Troubleshooting

**PostgreSQL connection refused:**

```bash
docker compose logs postgres
docker compose restart postgres
```

**Redis connection error:**

```bash
docker compose restart redis
```

**Claude API timeout:**

- Check `ANTHROPIC_API_KEY` is valid
- Verify network access to `api.anthropic.com`

**AWS Cost Explorer errors:**

- Ensure IAM user has `ce:GetCostAndUsage` permission
- Check `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`

**Tests failing:**

```bash
# Ensure Docker is running
docker compose up -d
# Clean stale test data
docker compose exec postgres psql -U copilot -d copilot_db -c "DELETE FROM jobs WHERE name LIKE 'vitest-%'"
npm run test:run
```

**Rate limit exceeded during development:**

```bash
# Development limits are 100 req/15min for chat
# Wait 15 minutes or restart server to reset counters
npm run dev
```

---

## Roadmap

- [x] Backend: Node.js 24 + TypeScript + Express
- [x] MCP servers: PostgreSQL, Redis, AWS Cost Explorer
- [x] Claude agentic loop with tool use
- [x] Integration tests with Vitest
- [x] **Conversation history persistence**
- [x] **Rate limiting middleware**
- [x] **Enhanced security (10kb payload limit)**
- [ ] Frontend: Angular 21 with signals and zoneless change detection
- [ ] Deployment guide (AWS ECS / Render / Railway)
- [ ] Streaming responses for long-running tool calls
- [ ] Additional MCP tools (GitHub, Slack, Datadog)
- [ ] Conversation export (JSON, markdown, PDF)
- [ ] Full-text search on conversation history

---

## Further reading

- [MCP Protocol Specification](https://modelcontextprotocol.io)
- [Anthropic Claude API Docs](https://docs.anthropic.com)
- [Node.js 24 Release Notes](https://nodejs.org/en/blog/release/v24.0.0)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/)
- [Pino Logger Best Practices](https://getpino.io/#/docs/best-practices)
- [Express Rate Limit](https://express-rate-limit.mintlify.app/)

---

## License

MIT © [Abhishek Panchal](https://github.com/abhishekpanchal). See [LICENSE](./LICENSE) for full text.

---

## Contributing

Contributions, bug reports, and feature requests are welcome! Please read [CONTRIBUTING.md](./CONTRIBUTING.md) before opening a PR.

---

## Documentation

- [Technical Documentation & Flow Diagrams](./docs/README.md)
- [OpenAPI / Swagger Spec](./docs/openapi.yaml)
- [Security Architecture](./docs/SECURITY.md)

---

**Built with ❤️ by [Abhishek Panchal](https://github.com/abhishekpanchal) using Node.js 24, TypeScript, Claude API, and the Model Context Protocol.**
