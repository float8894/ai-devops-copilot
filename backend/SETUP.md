# AI DevOps Copilot — Backend Setup Guide

Complete guide to setting up the Node.js 24 + TypeScript backend from scratch.

---

## Prerequisites

```bash
node --version   # Must be v24+
npm --version    # Must be v10+
docker --version # For PostgreSQL + Redis
```

---

## Quick Start (if repo is already cloned)

```bash
cd ai-devops-copilot/backend
npm install
cp .env.example .env
# Edit .env with your API keys
docker compose up -d
npm run dev
```

---

## From Scratch Setup

### Step 1 — Create project structure

```bash
mkdir -p ai-devops-copilot/backend && cd ai-devops-copilot/backend
mkdir -p src/{config,errors,lib,mcp-servers,models,orchestrator/{middleware,routes}}
mkdir docker
```

### Step 2 — Initialize package.json

```bash
npm init -y
```

Replace the generated `package.json` entirely with:

```json
{
  "name": "ai-devops-copilot",
  "version": "1.0.0",
  "description": "AI DevOps Copilot backend — Node.js 24 + TypeScript + MCP + Claude API",
  "type": "module",
  "scripts": {
    "dev": "node --env-file=.env --import tsx/esm --watch src/index.ts",
    "build": "tsc",
    "start": "node --env-file=.env dist/index.js",
    "dev:server": "node --env-file=.env --import tsx/esm src/index.ts",
    "mcp:postgres": "node --env-file=.env --import tsx/esm src/mcp-servers/postgres-server.ts",
    "mcp:redis": "node --env-file=.env --import tsx/esm src/mcp-servers/redis-server.ts",
    "mcp:aws": "node --env-file=.env --import tsx/esm src/mcp-servers/aws-server.ts",
    "test": "vitest",
    "test:run": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "engines": {
    "node": ">=24.0.0"
  }
}
```

### Step 3 — Install dependencies

**Production:**
```bash
npm install express @anthropic-ai/sdk @modelcontextprotocol/sdk@^1 \
  pg ioredis @aws-sdk/client-cost-explorer zod pino pino-pretty helmet cors
```

**Development:**
```bash
npm install -D typescript tsx vitest \
  @types/node @types/express @types/pg @types/cors
```

### Step 4 — Create tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

### Step 5 — Environment configuration

**Create `.env.example` (commit this):**
```env
NODE_ENV=development
PORT=3000
DATABASE_URL=postgresql://copilot:copilot_dev@localhost:5432/copilot_db
REDIS_URL=redis://localhost:6379
ANTHROPIC_API_KEY=sk-ant-your-key-here
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your-access-key-id
AWS_SECRET_ACCESS_KEY=your-secret-access-key
ALLOWED_ORIGIN=http://localhost:4200
```

**Create `.env` (NEVER commit):**
```bash
cp .env.example .env
# Edit with real values
```

### Step 6 — Create .gitignore

```gitignore
# Dependencies
node_modules/

# Build output
dist/

# Environment — NEVER commit
.env
.env.*
!.env.example

# Logs
*.log
logs/

# OS
.DS_Store
Thumbs.db

# IDE
.vscode/settings.json
.idea/

# TypeScript
*.tsbuildinfo
```

### Step 7 — Docker infrastructure

**Create `docker-compose.yml`:**
```yaml
services:
  postgres:
    image: postgres:16-alpine
    container_name: copilot_postgres
    environment:
      POSTGRES_USER: copilot
      POSTGRES_PASSWORD: copilot_dev
      POSTGRES_DB: copilot_db
    ports:
      - '5432:5432'
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./docker/init.sql:/docker-entrypoint-initdb.d/init.sql
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U copilot -d copilot_db']
      interval: 5s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    container_name: copilot_redis
    ports:
      - '6379:6379'
    healthcheck:
      test: ['CMD', 'redis-cli', 'ping']
      interval: 5s
      timeout: 3s
      retries: 5

volumes:
  postgres_data:
```

**Create `docker/init.sql`:**
```sql
CREATE TABLE IF NOT EXISTS jobs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR(255) NOT NULL,
  status      VARCHAR(50)  NOT NULL CHECK (status IN ('pending','running','failed','completed')),
  error_message TEXT,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_jobs_status_created
  ON jobs (status, created_at DESC);

-- Seed realistic failed jobs for testing
INSERT INTO jobs (name, status, error_message, created_at) VALUES
  ('send-invoice-emails',  'failed', 'SMTP connection refused: connect ECONNREFUSED 10.0.0.5:587', NOW() - INTERVAL '2 hours'),
  ('sync-stripe-webhooks', 'failed', 'Stripe API rate limit exceeded (429)', NOW() - INTERVAL '5 hours'),
  ('generate-pdf-reports', 'failed', 'Out of memory: Killed process 1842', NOW() - INTERVAL '8 hours'),
  ('backup-user-data',     'failed', 'S3 PutObject: Access Denied (403)', NOW() - INTERVAL '12 hours'),
  ('process-csv-import',   'failed', 'CSV parse error at row 1042: unexpected EOF', NOW() - INTERVAL '1 day'),
  ('send-invoice-emails',  'completed', NULL, NOW() - INTERVAL '30 minutes'),
  ('sync-stripe-webhooks', 'completed', NULL, NOW() - INTERVAL '1 hour'),
  ('health-check',         'completed', NULL, NOW() - INTERVAL '5 minutes');
```

### Step 8 — Start infrastructure

```bash
docker compose up -d
docker compose ps
```

Expected output:
```
NAME               STATUS
copilot_postgres   Up (healthy)
copilot_redis      Up (healthy)
```

### Step 9 — Copy source files

The repository includes complete implementations in `src/`. After copying:

```
src/
├── config/
│   └── env.ts                          # Zod env validation
├── errors/
│   └── index.ts                        # AppError, DatabaseError, McpToolError, ValidationError
├── lib/
│   ├── database.ts                     # PostgreSQL pool + query helper
│   ├── database.test.ts                # Vitest integration tests
│   ├── logger.ts                       # Pino structured logging
│   └── redis.ts                        # ioredis client
├── mcp-servers/
│   ├── postgres-server.ts              # Tool: query_failed_jobs
│   ├── redis-server.ts                 # Tool: get_redis_stats
│   └── aws-server.ts                   # Tool: get_aws_costs
├── models/
│   └── job.ts                          # TypeScript interfaces (JobRow, RedisStats, AwsCostEntry)
├── orchestrator/
│   ├── index.ts                        # Express app factory
│   ├── claude.ts                       # Claude agentic loop
│   ├── tools.ts                        # Anthropic tool definitions
│   ├── tool-dispatcher.ts              # Routes tool calls to implementations
│   ├── middleware/
│   │   └── error-handler.ts            # Centralized error middleware
│   └── routes/
│       └── chat.ts                     # POST /api/chat endpoint
└── index.ts                            # Entry point + graceful shutdown
```

### Step 10 — Verify setup

```bash
# Type-check
npm run typecheck

# Run tests (requires Docker running)
npm run test:run

# Start dev server
npm run dev
```

Server should start on http://localhost:3000

---

## Verify Everything Works

### 1. Health check
```bash
curl http://localhost:3000/health
# Should return: {"status":"ok","timestamp":"..."}
```

### 2. Test the chat endpoint
```bash
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "How many jobs failed in the last 24 hours?"}'
```

Expected response includes:
- `reply`: Natural language answer from Claude
- `toolsUsed`: Array of tool names called (e.g. `["query_failed_jobs"]`)

### 3. Run MCP servers individually
```bash
# Each server runs as a standalone process
npm run mcp:postgres  # Listens on stdio for query_failed_jobs calls
npm run mcp:redis     # Listens on stdio for get_redis_stats calls
npm run mcp:aws       # Listens on stdio for get_aws_costs calls
```

---

## Current Directory Structure

```
backend/
├── docker/
│   └── init.sql                        # PostgreSQL seed data
├── src/
│   ├── config/
│   │   └── env.ts
│   ├── errors/
│   │   └── index.ts
│   ├── lib/
│   │   ├── database.test.ts            # ← Integration tests (new)
│   │   ├── database.ts
│   │   ├── logger.ts
│   │   └── redis.ts
│   ├── mcp-servers/
│   │   ├── aws-server.ts               # ← Complete (new)
│   │   ├── postgres-server.ts
│   │   └── redis-server.ts
│   ├── models/
│   │   └── job.ts
│   ├── orchestrator/
│   │   ├── claude.ts
│   │   ├── index.ts
│   │   ├── middleware/
│   │   │   └── error-handler.ts
│   │   ├── routes/
│   │   │   └── chat.ts
│   │   ├── tool-dispatcher.ts
│   │   └── tools.ts
│   └── index.ts
├── .env                                # ← Never commit
├── .env.example
├── .gitignore
├── docker-compose.yml
├── package.json
├── package-lock.json
├── SETUP.md                            # ← This file
└── tsconfig.json
```

---

## Troubleshooting

**PostgreSQL connection refused:**
```bash
docker compose ps
docker compose logs postgres
```

**Redis connection error:**
```bash
docker compose restart redis
```

**TypeScript errors:**
```bash
npm run typecheck
```

**Tests failing:**
```bash
# Ensure Docker is running
docker compose ps
# Clean test data
docker compose exec postgres psql -U copilot -d copilot_db -c "DELETE FROM jobs WHERE name LIKE 'vitest-%'"
npm run test:run
```

**Claude API errors:**
- Verify `ANTHROPIC_API_KEY` in `.env`
- Check API key at https://console.anthropic.com

**AWS Cost Explorer errors:**
- Ensure IAM user has `ce:GetCostAndUsage` permission
- Verify `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`

---

## Next Steps

1.  Backend complete
2.  Build Angular 21 frontend (see `/frontend` directory)
3. Deploy to production (AWS ECS, Render, or Railway)

For development workflow, always run:
```bash
docker compose up -d  # Start infra
npm run dev           # Watch mode with hot reload
```
