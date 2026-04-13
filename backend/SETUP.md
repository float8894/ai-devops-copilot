# AI DevOps Copilot — Backend Scaffolding Guide

## Prerequisites

```bash
node --version   # Must be v24+
npm --version    # Must be v10+
```

---

## Step 1 — Create the project folder

```bash
mkdir ai-devops-copilot && cd ai-devops-copilot
mkdir -p src/{config,errors,lib,mcp-servers,orchestrator/routes,models}
```

---

## Step 2 — Initialize package.json

```bash
npm init -y
```

Then open `package.json` and replace its contents entirely with:

```json
{
  "name": "ai-devops-copilot",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
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

---

## Step 3 — Install production dependencies

```bash
# Core framework
npm install express

# MCP SDK — use v1.x monolithic, NOT v2 split packages (pre-alpha as of April 2026)
npm install @modelcontextprotocol/sdk@^1

# Claude API
npm install @anthropic-ai/sdk

# PostgreSQL
npm install pg

# Redis
npm install ioredis

# AWS SDK v3 — modular, import only what you use
npm install @aws-sdk/client-cost-explorer

# Validation
npm install zod

# Logging
npm install pino pino-pretty

# Security
npm install helmet cors
```

---

## Step 4 — Install dev dependencies

```bash
# TypeScript
npm install -D typescript

# Dev runner (never ts-node)
npm install -D tsx

# Type definitions
npm install -D @types/node @types/express @types/pg @types/cors

# Testing
npm install -D vitest
```

---

## Step 5 — Create tsconfig.json

Create `tsconfig.json` in the project root:

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

---

## Step 6 — Create .env

Create `.env` in the project root (never commit this):

```env
NODE_ENV=development
PORT=3000

# PostgreSQL — matches docker-compose.yml
DATABASE_URL=postgresql://copilot:copilot_dev@localhost:5432/copilot_db

# Redis — matches docker-compose.yml
REDIS_URL=redis://localhost:6379

# Get from https://console.anthropic.com
ANTHROPIC_API_KEY=sk-ant-...

# AWS credentials (use IAM role with CostExplorer read-only)
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=...

# CORS — Angular dev server
ALLOWED_ORIGIN=http://localhost:4200
```

---

## Step 7 — Create .gitignore

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

---

## Step 8 — Create .env.example

Commit this — it documents required vars without secrets:

```env
NODE_ENV=development
PORT=3000
DATABASE_URL=postgresql://user:password@localhost:5432/copilot_db
REDIS_URL=redis://localhost:6379
ANTHROPIC_API_KEY=sk-ant-your-key-here
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your-access-key-id
AWS_SECRET_ACCESS_KEY=your-secret-access-key
ALLOWED_ORIGIN=http://localhost:4200
```

---

## Step 9 — Create docker-compose.yml

Local PostgreSQL + Redis. No app containers yet (you run the app with `npm run dev`):

```yaml
version: '3.9'

services:
  postgres:
    image: postgres:16-alpine
    container_name: copilot_postgres
    environment:
      POSTGRES_USER: copilot
      POSTGRES_PASSWORD: copilot_dev
      POSTGRES_DB: copilot_db
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./docker/init.sql:/docker-entrypoint-initdb.d/init.sql
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U copilot -d copilot_db"]
      interval: 5s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    container_name: copilot_redis
    ports:
      - "6379:6379"
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 5

volumes:
  postgres_data:
```

---

## Step 10 — Create docker/init.sql

Seed schema for the jobs table (PostgreSQL runs this automatically on first start):

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

-- Seed some realistic failed jobs for dev/testing
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

---

## Step 11 — Start infrastructure

```bash
# Create the docker dir first
mkdir docker

# Start Postgres + Redis
docker compose up -d

# Verify both are healthy
docker compose ps
```

Expected output:
```
NAME               STATUS
copilot_postgres   Up (healthy)
copilot_redis      Up (healthy)
```

---

## Step 12 — Verify the full setup

```bash
# Type-check (should pass with 0 errors once you add src files)
npm run typecheck

# Run dev server
npm run dev
```

---

## Final folder structure after scaffolding

```
ai-devops-copilot/
├── docker/
│   └── init.sql
├── src/
│   ├── config/
│   ├── errors/
│   ├── lib/
│   ├── mcp-servers/
│   ├── models/
│   └── orchestrator/
│       └── routes/
├── .env                  ← never commit
├── .env.example          ← commit this
├── .gitignore
├── .claude/              ← see CLAUDE.md
│   └── CLAUDE.md
├── docker-compose.yml
├── package.json
└── tsconfig.json
```

Next step: copy the source files from the project into `src/` and run `npm run dev`.
