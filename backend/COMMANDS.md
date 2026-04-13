# Backend Quick Reference

Common commands and workflows for the AI DevOps Copilot backend.

---

## Daily Development Workflow

```bash
# 1. Start infrastructure
cd backend
docker compose up -d

# 2. Start dev server (hot reload)
npm run dev

# 3. In another terminal, run tests on save
npm run test
```

---

## NPM Scripts

```bash
npm run dev           # Hot reload dev server (tsx watch mode)
npm run build         # Compile TypeScript → dist/
npm start             # Run production build (requires .env file)
npm run dev:server    # Dev server without watch (single run)
npm run test          # Vitest watch mode
npm run test:run      # Vitest single run (CI)
npm run typecheck     # TypeScript type-check only

# MCP servers (run individually for testing)
npm run mcp:postgres  # Standalone PostgreSQL MCP server
npm run mcp:redis     # Standalone Redis MCP server
npm run mcp:aws       # Standalone AWS MCP server
```

---

## Docker Commands

```bash
# Start infrastructure
docker compose up -d

# Check status
docker compose ps

# View logs
docker compose logs postgres
docker compose logs redis
docker compose logs -f  # Follow all logs

# Restart services
docker compose restart postgres
docker compose restart redis

# Stop everything
docker compose down

# Stop and remove volumes (DELETES ALL DATA)
docker compose down -v

# Access PostgreSQL shell
docker compose exec postgres psql -U copilot -d copilot_db

# Access Redis CLI
docker compose exec redis redis-cli
```

---

## PostgreSQL Commands

```bash
# Connect to PostgreSQL
docker compose exec postgres psql -U copilot -d copilot_db

# Inside psql:
\dt                          # List tables
\d jobs                      # Describe jobs table
SELECT * FROM jobs LIMIT 5;  # Query data
\q                           # Quit
```

---

## Testing Workflows

```bash
# Run all tests once
npm run test:run

# Watch mode (re-runs on file changes)
npm run test

# Type-check without running tests
npm run typecheck

# Clean test data manually
docker compose exec postgres psql -U copilot -d copilot_db \
  -c "DELETE FROM jobs WHERE name LIKE 'vitest-%'"
```

---

## API Testing

```bash
# Health check
curl http://localhost:3000/health

# Test chat endpoint
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "How many jobs failed in the last 24 hours?"}'

# With jq for pretty output
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "What is our Redis hit rate?"}' | jq
```

---

## Debugging

```bash
# Check environment variables are loaded
npm run dev
# Look for "Server started" log with correct PORT

# Verify PostgreSQL connection
docker compose exec postgres pg_isready -U copilot

# Verify Redis connection
docker compose exec redis redis-cli ping
# Should return: PONG

# Check logs with structured output
npm run dev | grep ERROR
npm run dev | grep -i "tool"

# View Pino pretty logs in dev
# Already enabled via NODE_ENV=development
```

---

## Environment Variables

Required in `.env`:

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

---

## Troubleshooting

**Port 3000 already in use:**
```bash
lsof -ti:3000 | xargs kill -9
```

**Port 5432 already in use:**
```bash
# Stop local PostgreSQL
brew services stop postgresql  # macOS
sudo systemctl stop postgresql  # Linux
```

**Port 6379 already in use:**
```bash
# Stop local Redis
brew services stop redis  # macOS
sudo systemctl stop redis  # Linux
```

**Docker containers won't start:**
```bash
docker compose down
docker compose up -d --force-recreate
```

**TypeScript errors after npm install:**
```bash
rm -rf node_modules package-lock.json
npm install
npm run typecheck
```

**Tests failing with "connection refused":**
```bash
# Ensure Docker is running
docker compose ps
docker compose up -d
npm run test:run
```

---

## Production Build

```bash
# 1. Build TypeScript
npm run build

# 2. Verify dist/ folder
ls -la dist/

# 3. Run production build
npm start

# Or with explicit env file
node --env-file=.env dist/index.js
```

---

## Code Quality Checks

```bash
# Type-check
npm run typecheck

# Run tests
npm run test:run

# Check for uncommitted changes
git status

# View recent logs
docker compose logs --tail=50
```
