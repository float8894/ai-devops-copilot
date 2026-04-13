# Quick Installation Guide

## Install New Dependency

```bash
cd backend
npm install express-rate-limit
```

This will install the rate limiting middleware.

---

## Apply Database Changes

### Option 1: Fresh Installation (Recommended for Development)

If you're okay with resetting your database:

```bash
# Stop containers and remove volumes
docker compose down -v

# Start fresh with new schema
docker compose up -d

# Verify tables were created
docker compose exec postgres psql -U copilot -d copilot_db -c "\dt"
```

Expected tables:
- `jobs`
- `conversations`
- `messages`

---

### Option 2: Migration (Keep Existing Data)

If you want to keep your existing jobs data:

**Step 1: Connect to PostgreSQL**
```bash
docker compose exec postgres psql -U copilot -d copilot_db
```

**Step 2: Run these SQL commands:**
```sql
-- Create conversations table
CREATE TABLE IF NOT EXISTS conversations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conversations_updated
  ON conversations (updated_at DESC);

-- Create messages table
CREATE TABLE IF NOT EXISTS messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role            VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant')),
  content         TEXT NOT NULL,
  tools_used      TEXT[],
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation
  ON messages (conversation_id, created_at ASC);

-- Verify
\dt
```

**Step 3: Exit psql**
```
\q
```

---

## Verify Installation

### 1. Check npm packages
```bash
npm list express-rate-limit
# Should show: express-rate-limit@7.5.0
```

### 2. Check database tables
```bash
docker compose exec postgres psql -U copilot -d copilot_db -c "\dt"
```

Expected output:
```
             List of relations
 Schema |      Name       | Type  |  Owner
--------+-----------------+-------+---------
 public | conversations   | table | copilot
 public | jobs            | table | copilot
 public | messages        | table | copilot
```

### 3. Test the server
```bash
npm run dev
```

Should start without errors and show:
```
[INFO] Server started {"port":3000,"env":"development"}
```

---

## Test New Features

### Conversation History
```bash
# First message
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "How many jobs failed?"}'

# Copy the conversationId from response, then:
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "What about Redis?", "conversationId": "PASTE-ID-HERE"}'
```

### Rate Limiting
```bash
# Send 25 requests rapidly (production limit is 20)
for i in {1..25}; do
  curl -s -o /dev/null -w "%{http_code}\n" \
    -X POST http://localhost:3000/api/chat \
    -H "Content-Type: application/json" \
    -d '{"message": "test"}'
done

# First 100 should return 200 (dev mode)
# Then 429 Too Many Requests
```

---

## Troubleshooting

**"express-rate-limit not found"**
```bash
rm -rf node_modules package-lock.json
npm install
```

**"relation 'conversations' does not exist"**
```bash
# Run the migration SQL commands above
# OR
docker compose down -v && docker compose up -d
```

**"Server won't start"**
```bash
npm run typecheck  # Check for TypeScript errors
docker compose ps  # Check PostgreSQL is running
```

---

## Rollback (If Needed)

If you need to undo these changes:

```bash
# Remove rate limiting package
npm uninstall express-rate-limit

# Drop new tables (keeps jobs table)
docker compose exec postgres psql -U copilot -d copilot_db -c \
  "DROP TABLE IF EXISTS messages CASCADE; 
   DROP TABLE IF EXISTS conversations CASCADE;"

# Checkout previous git commit (if using git)
git checkout HEAD~1 backend/
```

---

**Installation complete!** See `IMPROVEMENTS.md` for full documentation.
