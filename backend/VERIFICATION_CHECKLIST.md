#  Implementation Verification Checklist

Use this checklist to verify all improvements are working correctly.

---

##  Installation Verification

### 1. Package Installation
```bash
cd backend
npm list express-rate-limit
```
**Expected:** `express-rate-limit@7.5.0`

**Status:** [ ]  Installed

---

### 2. TypeScript Compilation
```bash
npm run typecheck
```
**Expected:** `0 errors`

**Status:** [ ]  No errors

---

### 3. Database Schema
```bash
docker compose exec postgres psql -U copilot -d copilot_db -c "\dt"
```
**Expected tables:**
- `jobs`
- `conversations`
- `messages`

**Status:** [ ]  All tables present

---

##  Feature Testing

### 4. Server Starts Successfully
```bash
npm run dev
```
**Expected logs:**
- `Server started {"port":3000,"env":"development"}`
- No errors

**Status:** [ ]  Server running

---

### 5. Health Check Works
```bash
curl http://localhost:3000/health
```
**Expected:**
```json
{"status":"ok","timestamp":"..."}
```

**Status:** [ ]  Health check OK

---

### 6. Conversation History — Create New Conversation
```bash
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "How many jobs failed in the last hour?"}' | jq
```

**Expected:**
- `reply`: Contains answer about failed jobs
- `toolsUsed`: Contains `["query_failed_jobs"]`
- `conversationId`: UUID string (save this for next test)

**Status:** [ ]  New conversation created

---

### 7. Conversation History — Continue Conversation
```bash
# Replace CONVERSATION_ID with the ID from step 6
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "What about Redis cache performance?", "conversationId": "CONVERSATION_ID"}' | jq
```

**Expected:**
- `reply`: Contains answer about Redis
- `toolsUsed`: Contains `["get_redis_stats"]`
- `conversationId`: Same as previous message

**Status:** [ ]  Conversation continued

---

### 8. Conversation History — Verify in Database
```bash
# Use the conversationId from step 6
docker compose exec postgres psql -U copilot -d copilot_db -c \
  "SELECT role, LEFT(content, 40) as preview FROM messages WHERE conversation_id = 'CONVERSATION_ID' ORDER BY created_at;"
```

**Expected:**
- 2 user messages
- 2 assistant messages
- In chronological order

**Status:** [ ]  Messages stored correctly

---

### 9. Rate Limiting — Normal Requests Pass
```bash
for i in {1..5}; do
  curl -s -o /dev/null -w "Request $i: %{http_code}\n" \
    -X POST http://localhost:3000/api/chat \
    -H "Content-Type: application/json" \
    -d '{"message": "test"}'
done
```

**Expected:**
```
Request 1: 200
Request 2: 200
Request 3: 200
Request 4: 200
Request 5: 200
```

**Status:** [ ]  Normal requests work

---

### 10. Rate Limiting — Spam Gets Blocked
```bash
# Send 105 requests rapidly (dev limit is 100/15min)
for i in {1..105}; do
  curl -s -o /dev/null -w "%{http_code}\n" \
    -X POST http://localhost:3000/api/chat \
    -H "Content-Type: application/json" \
    -d '{"message": "test"}' | tail -1
done | tail -10
```

**Expected (last 10 lines):**
```
200
200
200
200
200
429  ← First rate limited request
429
429
429
429
```

**Status:** [ ]  Rate limiting works

---

### 11. Rate Limit Headers Present
```bash
curl -I -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "test"}' | grep RateLimit
```

**Expected:**
```
RateLimit-Limit: 100
RateLimit-Remaining: 99
RateLimit-Reset: <timestamp>
```

**Status:** [ ]  Headers present

---

### 12. Size Limit — Large Payload Rejected
```bash
# Generate message > 10kb
python3 -c "print('A' * 11000)" > /tmp/large_message.txt

curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d "{\"message\": \"$(cat /tmp/large_message.txt)\"}" \
  -w "\nHTTP Status: %{http_code}\n"
```

**Expected:**
```
HTTP Status: 413
```

**Status:** [ ]  Large payloads rejected

---

### 13. Size Limit — Normal Payload Accepted
```bash
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "What is our Redis hit rate?"}' \
  -w "\nHTTP Status: %{http_code}\n" | tail -1
```

**Expected:**
```
HTTP Status: 200
```

**Status:** [ ]  Normal payloads work

---

### 14. Multi-Source Query Works
```bash
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "Show me failed jobs, Redis stats, and AWS costs"}' | jq .toolsUsed
```

**Expected:**
```json
[
  "query_failed_jobs",
  "get_redis_stats",
  "get_aws_costs"
]
```

**Status:** [ ]  Multi-tool queries work

---

### 15. Claude References Previous Context
```bash
# First message
CONV_ID=$(curl -s -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "How many jobs failed in the last 24 hours?"}' | jq -r .conversationId)

# Second message referencing previous
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d "{\"message\": \"Are there any patterns in those failures?\", \"conversationId\": \"$CONV_ID\"}" | jq .reply
```

**Expected:**
- Reply references "those failures" from previous message
- No need to re-query (uses context)

**Status:** [ ]  Context awareness works

---

##  Database Verification

### 16. Conversation Table Has Data
```bash
docker compose exec postgres psql -U copilot -d copilot_db -c \
  "SELECT COUNT(*) FROM conversations;"
```

**Expected:** Number > 0

**Status:** [ ]  Conversations stored

---

### 17. Message Table Has Data
```bash
docker compose exec postgres psql -U copilot -d copilot_db -c \
  "SELECT COUNT(*) FROM messages;"
```

**Expected:** Number > 0

**Status:** [ ]  Messages stored

---

### 18. Foreign Key Constraint Works
```bash
docker compose exec postgres psql -U copilot -d copilot_db -c \
  "DELETE FROM conversations WHERE id = (SELECT conversation_id FROM messages LIMIT 1);"

docker compose exec postgres psql -U copilot -d copilot_db -c \
  "SELECT COUNT(*) FROM messages WHERE conversation_id NOT IN (SELECT id FROM conversations);"
```

**Expected:** `0` (cascade delete worked)

**Status:** [ ]  Cascade deletion works

---

### 19. Indexes Exist
```bash
docker compose exec postgres psql -U copilot -d copilot_db -c \
  "SELECT indexname FROM pg_indexes WHERE tablename IN ('conversations', 'messages');"
```

**Expected:**
- `idx_conversations_updated`
- `idx_messages_conversation`

**Status:** [ ]  Indexes created

---

##  Performance Verification

### 20. Conversation Load Time <100ms
```bash
# Create a conversation with 10 messages
CONV_ID=$(curl -s -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "test 1"}' | jq -r .conversationId)

for i in {2..10}; do
  curl -s -X POST http://localhost:3000/api/chat \
    -H "Content-Type: application/json" \
    -d "{\"message\": \"test $i\", \"conversationId\": \"$CONV_ID\"}" > /dev/null
done

# Time the 11th message (loads 20 messages of history)
time curl -s -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d "{\"message\": \"test 11\", \"conversationId\": \"$CONV_ID\"}" > /dev/null
```

**Expected:** Total time < 5 seconds (includes Claude API latency)

**Status:** [ ]  Performance acceptable

---

##  Final Checklist

All tests passing:

- [ ] Installation (3 checks)
- [ ] Server & Health (2 checks)
- [ ] Conversation History (4 checks)
- [ ] Rate Limiting (3 checks)
- [ ] Size Limits (2 checks)
- [ ] Multi-tool & Context (2 checks)
- [ ] Database (4 checks)
- [ ] Performance (1 check)

**Total:** 0/21 checks completed

---

##  If Any Tests Fail

**Conversation history not working:**
```bash
docker compose down -v
docker compose up -d
npm run dev
```

**Rate limiting not working:**
```bash
npm list express-rate-limit  # Verify installed
npm run dev                  # Restart server
```

**Database tables missing:**
```bash
docker compose exec postgres psql -U copilot -d copilot_db < docker/init.sql
```

**TypeScript errors:**
```bash
rm -rf node_modules package-lock.json
npm install
npm run typecheck
```

---

**Once all checks pass, the implementation is production-ready!** 
