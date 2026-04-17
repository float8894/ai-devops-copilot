# AI DevOps Copilot — Technical Documentation

> **Version:** 1.0.0 · **Runtime:** Node.js 24 (ESM) · **Language:** TypeScript 5 strict  
> **Branch:** `feature/authentication` · **Last Updated:** April 2026

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Architecture Diagram](#2-architecture-diagram)
3. [Component Breakdown](#3-component-breakdown)
4. [Data Flow Diagrams](#4-data-flow-diagrams)
   - 4.1 [User Registration](#41-user-registration)
   - 4.2 [User Login](#42-user-login)
   - 4.3 [Token Refresh](#43-token-refresh)
   - 4.4 [Authenticated Chat Request (non-streaming)](#44-authenticated-chat-request-non-streaming)
   - 4.5 [Authenticated Chat Request (SSE streaming)](#45-authenticated-chat-request-sse-streaming)
   - 4.6 [AWS Account Management](#46-aws-account-management)
   - 4.7 [Claude Agentic Tool Loop](#47-claude-agentic-tool-loop)
   - 4.8 [STS AssumeRole with Redis Cache](#48-sts-assumerole-with-redis-cache)
5. [Database Schema](#5-database-schema)
6. [Security Model](#6-security-model)
7. [Rate Limiting](#7-rate-limiting)
8. [Environment Variables](#8-environment-variables)
9. [Error Hierarchy](#9-error-hierarchy)
10. [API Reference (summary)](#10-api-reference-summary)

---

## 1. System Overview

The AI DevOps Copilot is a conversational backend that lets engineers ask plain-English questions about their infrastructure and receive intelligent, tool-backed answers. Engineers type questions like:

- _"Why did costs spike on Tuesday?"_
- _"How many failed jobs in the last 24 hours?"_
- _"Is the Redis cache healthy?"_

The system:

1. Authenticates the user via **JWT (HS256)**.
2. Resolves their linked **AWS IAM Role ARN** and exchanges it for short-lived credentials via **AWS STS AssumeRole**.
3. Sends the message to **Claude (Anthropic API)** which decides which tools to call.
4. Executes database, cache, or cloud queries through typed tool handlers.
5. Returns a natural-language reply with citations.

---

## 2. Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                               CLIENT (Angular :4200)                         │
│                                                                              │
│   POST /api/auth/login          POST /api/chat           POST /api/chat/stream│
│   GET  /api/auth/me             Bearer: <access_token>   (SSE)              │
└──────────────────────────────────┬───────────────────────────────────────────┘
                                   │ HTTPS
                                   ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                        EXPRESS SERVER  (port 3000)                           │
│                                                                              │
│  ┌─────────────┐  ┌──────────────────┐  ┌────────────────────────────────┐  │
│  │   Helmet    │  │   CORS           │  │  AsyncLocalStorage (requestId) │  │
│  │  (headers)  │  │  (:4200 / prod)  │  │                                │  │
│  └─────────────┘  └──────────────────┘  └────────────────────────────────┘  │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐    │
│  │                      ROUTE GROUPS                                    │    │
│  │                                                                      │    │
│  │  /health   ──── no auth, no rate limit                              │    │
│  │                                                                      │    │
│  │  /api/auth ──── authRateLimiter (5/15min prod)                      │    │
│  │            │                                                         │    │
│  │            ├── POST /register                                        │    │
│  │            ├── POST /login                                           │    │
│  │            ├── POST /refresh  (reads httpOnly cookie)                │    │
│  │            ├── POST /logout                                          │    │
│  │            └── GET  /me  (requires authenticate middleware)          │    │
│  │                                                                      │    │
│  │  /api/aws-accounts ── authenticate ── CRUD                          │    │
│  │                                                                      │    │
│  │  /api/chat ─────────── authenticate ── chatRateLimiter (20/15min)  │    │
│  │            ├── POST /                                                │    │
│  │            └── POST /stream  (SSE)                                  │    │
│  └──────────────────────────────────────────────────────────────────────┘    │
└──────────────────────────────────┬───────────────────────────────────────────┘
                                   │
           ┌───────────────────────┼──────────────────────┐
           │                       │                      │
           ▼                       ▼                      ▼
┌──────────────────┐   ┌──────────────────────┐  ┌───────────────────┐
│   PostgreSQL     │   │    Redis (ioredis)    │  │  Anthropic API    │
│   (pg pool)      │   │                      │  │  Claude Sonnet    │
│                  │   │  refresh:{sha256}     │  │  (tool_use loop)  │
│  • jobs          │   │  sts:{userId}:{acId}  │  │                   │
│  • conversations │   │                      │  └─────────┬─────────┘
│  • messages      │   └──────────────────────┘            │
│  • users         │                                       │ tool calls
│  • aws_accounts  │   ┌──────────────────────┐            │
└──────────────────┘   │   AWS STS            │◄───────────┘
                       │   AssumeRole         │
                       │   (SDK v3)           │
                       └──────────────────────┘
```

---

## 3. Component Breakdown

| File                                           | Role                                                                                                                                                   |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/index.ts`                                 | Entry point. Eagerly connects Redis, starts Express, registers `SIGTERM`/`SIGINT` shutdown handlers                                                    |
| `src/config/env.ts`                            | Zod schema — validates all env vars at startup; process exits if any are missing                                                                       |
| `src/orchestrator/index.ts`                    | Express `createApp()` — wires middleware, routes, error handler. Exposes `AsyncLocalStorage` for `requestId` propagation                               |
| `src/orchestrator/claude.ts`                   | Agentic loop — sends messages to Claude, executes tool calls in parallel, accumulates history, detects `end_turn` / guards infinite loops              |
| `src/orchestrator/tools.ts`                    | Tool definitions for the Anthropic API (JSON schema descriptors)                                                                                       |
| `src/orchestrator/tool-dispatcher.ts`          | Routes Claude's tool-call by name → implementation                                                                                                     |
| `src/orchestrator/routes/chat.ts`              | `POST /api/chat` and `POST /api/chat/stream` — resolves AWS credentials, calls claude functions                                                        |
| `src/orchestrator/routes/auth.ts`              | Auth CRUD: register, login, refresh, logout, me                                                                                                        |
| `src/orchestrator/routes/aws-accounts.ts`      | AWS account CRUD — list, add, delete                                                                                                                   |
| `src/orchestrator/middleware/authenticate.ts`  | Extracts `Bearer` token, verifies JWT, attaches `req.user`                                                                                             |
| `src/orchestrator/middleware/require-role.ts`  | RBAC factory: `requireRole('admin')`                                                                                                                   |
| `src/orchestrator/middleware/rate-limit.ts`    | Three limiters: general / chat / auth                                                                                                                  |
| `src/orchestrator/middleware/error-handler.ts` | Centralized error → HTTP response mapping                                                                                                              |
| `src/lib/auth.ts`                              | `signAccessToken`, `signRefreshToken`, `verifyAccessToken`, `verifyRefreshToken`, `hashToken` (SHA-256), `hashPassword` / `verifyPassword` (bcrypt 12) |
| `src/lib/sts.ts`                               | `assumeRole()` — calls STS, caches short-lived credentials in Redis                                                                                    |
| `src/lib/database.ts`                          | pg pool + `query<T>()` helper + `withTransaction()`                                                                                                    |
| `src/lib/redis.ts`                             | ioredis client (`lazyConnect`, `enableOfflineQueue: false`)                                                                                            |
| `src/lib/logger.ts`                            | Pino structured logger                                                                                                                                 |
| `src/services/user.service.ts`                 | `createUser`, `findUserByEmail`, `findUserById`, `updateLastLogin`, `isFirstUser`                                                                      |
| `src/services/aws-account.service.ts`          | `addAccount`, `listAccounts`, `getDefaultAccount`, `getAccountById`, `deleteAccount`                                                                   |
| `src/services/conversation.service.ts`         | Conversation create/load/append                                                                                                                        |
| `src/tools/get-aws-costs.ts`                   | AWS Cost Explorer tool handler                                                                                                                         |
| `src/tools/get-redis-stats.ts`                 | Redis INFO tool handler                                                                                                                                |
| `src/tools/query-failed-jobs.ts`               | PostgreSQL jobs query handler                                                                                                                          |
| `src/errors/index.ts`                          | `AppError` hierarchy — `DatabaseError`, `ValidationError`, `AuthError`, `ForbiddenError`, `NotFoundError`, `McpToolError`                              |

---

## 4. Data Flow Diagrams

### 4.1 User Registration

```
Client                        Express                     PostgreSQL
  │                              │                             │
  │  POST /api/auth/register     │                             │
  │  { email, password }         │                             │
  ├─────────────────────────────►│                             │
  │                              │                             │
  │                              │  Zod: validate email        │
  │                              │  + password (min 8)         │
  │                              │                             │
  │                              │  isFirstUser()              │
  │                              ├────────────────────────────►│
  │                              │  SELECT COUNT(*) FROM users │
  │                              │◄────────────────────────────┤
  │                              │  count = 0 → role = 'admin' │
  │                              │  count > 0 → role = 'user'  │
  │                              │                             │
  │                              │  bcrypt.hash(password, 12)  │
  │                              │  [~300ms deliberate delay]  │
  │                              │                             │
  │                              │  INSERT INTO users          │
  │                              ├────────────────────────────►│
  │                              │◄────────────────────────────┤
  │                              │  { id, email, role }        │
  │                              │                             │
  │  201 { id, email, role }     │                             │
  │◄─────────────────────────────┤                             │
```

**Security notes:**

- Duplicate email → generic `"Registration failed"` (email existence not leaked)
- bcrypt cost factor 12 ≈ 300ms per hash — brute-force resistant
- Auth route: 5 req/15min in production

---

### 4.2 User Login

```
Client                  Express                  PostgreSQL          Redis
  │                        │                         │                 │
  │ POST /api/auth/login   │                         │                 │
  │ { email, password }    │                         │                 │
  ├───────────────────────►│                         │                 │
  │                        │  Zod: validate          │                 │
  │                        │                         │                 │
  │                        │  findUserByEmail()      │                 │
  │                        ├────────────────────────►│                 │
  │                        │◄────────────────────────┤                 │
  │                        │  user row (or null)     │                 │
  │                        │                         │                 │
  │                        │  ┌───────────────────────────────────┐    │
  │                        │  │ CONSTANT-TIME PATH                │    │
  │                        │  │                                   │    │
  │                        │  │ if user found:                    │    │
  │                        │  │   bcrypt.compare(pw, hash)        │    │
  │                        │  │ if user NOT found:                │    │
  │                        │  │   bcrypt.compare(pw, dummyHash)   │    │
  │                        │  │   → always false                  │    │
  │                        │  │ (prevents timing attacks)         │    │
  │                        │  └───────────────────────────────────┘    │
  │                        │                         │                 │
  │                        │  signAccessToken()      │                 │
  │                        │  HS256, exp=15min       │                 │
  │                        │                         │                 │
  │                        │  signRefreshToken()     │                 │
  │                        │  HS256, exp=7d          │                 │
  │                        │                         │                 │
  │                        │  hashToken(refreshToken)│                 │
  │                        │  SHA-256 hex            │                 │
  │                        │                         │                 │
  │                        │  SETEX refresh:{hash}   │                 │
  │                        │  TTL=604800s (7d)       │                 │
  │                        ├────────────────────────────────────────►  │
  │                        │                         │                 │
  │                        │  updateLastLogin()      │                 │
  │                        ├────────────────────────►│                 │
  │                        │                         │                 │
  │ 200 { accessToken,     │                         │                 │
  │       user:{id,email,  │                         │                 │
  │            role} }     │                         │                 │
  │ Set-Cookie: refreshToken│                        │                 │
  │ (httpOnly, secure,     │                         │                 │
  │  sameSite=strict,      │                         │                 │
  │  path=/api/auth)       │                         │                 │
  │◄───────────────────────┤                         │                 │
```

**Security notes:**

- Refresh token stored as `SHA-256(token)` in Redis — raw token never persisted
- Cookie: `httpOnly` (no JS access), `secure` (HTTPS only), `sameSite=strict` (CSRF resistant), scoped to `/api/auth`
- Access token in response body (memory, not localStorage)

---

### 4.3 Token Refresh

```
Client                    Express                         Redis
  │                          │                              │
  │ POST /api/auth/refresh   │                              │
  │ Cookie: refreshToken=... │                              │
  ├─────────────────────────►│                              │
  │                          │                              │
  │                          │  Read cookie                 │
  │                          │  verifyRefreshToken(raw)     │
  │                          │  → verify HS256 signature    │
  │                          │  → extract userId from sub   │
  │                          │                              │
  │                          │  hashToken(raw) → sha256hex  │
  │                          │                              │
  │                          │  GET refresh:{hash}          │
  │                          ├─────────────────────────────►│
  │                          │◄─────────────────────────────┤
  │                          │  storedUserId (or null)      │
  │                          │                              │
  │                          │  if storedUserId ≠ userId    │
  │                          │    → 401 "Refresh token      │
  │                          │      revoked"                │
  │                          │                              │
  │                          │  ┌──── TOKEN ROTATION ─────┐ │
  │                          │  │                         │ │
  │                          │  │ DEL refresh:{old_hash}  │ │
  │                          │  │ signAccessToken (15min) │ │
  │                          │  │ signRefreshToken (7d)   │ │
  │                          │  │ hashToken(newRefresh)   │ │
  │                          │  │ SETEX refresh:{newHash} │ │
  │                          │  └─────────────────────────┘ │
  │                          ├─────────────────────────────►│
  │                          │                              │
  │ 200 { accessToken }      │                              │
  │ Set-Cookie: refreshToken=<new>                          │
  │◄─────────────────────────┤                              │
```

**Security notes:**

- Every refresh call **rotates** both tokens — old refresh is immediately revoked
- If a stolen refresh token is used after rotation, the user's new token also becomes invalid (detects token theft)

---

### 4.4 Authenticated Chat Request (non-streaming)

```
Client              Express          Redis         AWS STS        Claude API       PostgreSQL/Redis/AWS
  │                    │               │              │                │                    │
  │ POST /api/chat     │               │              │                │                    │
  │ Authorization:     │               │              │                │                    │
  │ Bearer <token>     │               │              │                │                    │
  │ { message,         │               │              │                │                    │
  │   conversationId?, │               │              │                │                    │
  │   awsAccountId? }  │               │              │                │                    │
  ├───────────────────►│               │              │                │                    │
  │                    │               │              │                │                    │
  │                    │  authenticate │               │               │                    │
  │                    │  middleware   │               │               │                    │
  │                    │  verifyJWT()  │               │               │                    │
  │                    │  → req.user   │               │               │                    │
  │                    │               │              │                │                    │
  │                    │  Zod validate body            │               │                    │
  │                    │               │              │                │                    │
  │                    │  resolveAwsCredentials()      │               │                    │
  │                    │  getDefaultAccount(userId)    │               │                    │
  │                    │  ────────────────────────────►│               │                    │
  │                    │               │  GET sts:{userId}:{accountId} │                    │
  │                    │               ├──────────────►│               │                    │
  │                    │               │  cache miss   │               │                    │
  │                    │               │◄──────────────┤               │                    │
  │                    │  AssumeRole(roleArn, 3600s)   │               │                    │
  │                    │  ─────────────────────────────────────────────►                   │
  │                    │               │              │◄───────────────┤                    │
  │                    │               │  SET sts:{key} TTL=3540       │                    │
  │                    │               ├──────────────►│               │                    │
  │                    │               │              │                │                    │
  │                    │  runCopilotQuery(msg, convId, creds)          │                    │
  │                    │               │              │                │                    │
  │                    │  ┌──────────── AGENTIC LOOP ──────────────────────────────────┐   │
  │                    │  │                            │               │               │   │
  │                    │  │  POST /messages            │               │               │   │
  │                    │  │  model: claude-sonnet      │               │               │   │
  │                    │  │  tools: [query_failed_jobs,│               │               │   │
  │                    │  │          get_redis_stats,  │               │               │   │
  │                    │  │          get_aws_costs]    │               │               │   │
  │                    │  │  ─────────────────────────────────────────►│               │   │
  │                    │  │                            │               │               │   │
  │                    │  │  stop_reason=tool_use      │               │               │   │
  │                    │  │  ◄─────────────────────────────────────────┤               │   │
  │                    │  │                            │               │               │   │
  │                    │  │  Execute tools in parallel │               │               │   │
  │                    │  │  ────────────────────────────────────────────────────────►│   │
  │                    │  │                            │               │               │   │
  │                    │  │  Tool results              │               │               │   │
  │                    │  │  ◄──────────────────────────────────────────────────────── │   │
  │                    │  │                            │               │               │   │
  │                    │  │  POST /messages (with results)             │               │   │
  │                    │  │  ─────────────────────────────────────────►│               │   │
  │                    │  │                            │               │               │   │
  │                    │  │  stop_reason=end_turn      │               │               │   │
  │                    │  │  ◄─────────────────────────────────────────┤               │   │
  │                    │  │                            │               │               │   │
  │                    │  └───────────────────────────────────────────────────────────┘   │
  │                    │               │              │                │                    │
  │ 200 {              │               │              │                │                    │
  │   reply: "...",    │               │              │                │                    │
  │   toolsUsed: [...],│               │              │                │                    │
  │   conversationId   │               │              │                │                    │
  │ }                  │               │              │                │                    │
  │◄───────────────────┤               │              │                │                    │
```

---

### 4.5 Authenticated Chat Request (SSE streaming)

```
Client                     Express                      Claude API
  │                            │                             │
  │ POST /api/chat/stream      │                             │
  │ Authorization: Bearer <t>  │                             │
  ├───────────────────────────►│                             │
  │                            │  Same auth + STS flow       │
  │                            │  as non-streaming           │
  │                            │                             │
  │                            │  Set response headers:      │
  │                            │  Content-Type: text/        │
  │                            │  event-stream               │
  │                            │  Cache-Control: no-cache    │
  │                            │  Connection: keep-alive     │
  │                            │                             │
  │  event: tool_start         │  Tool calls execute         │
  │  data: {"tool":"query..."}◄│  (non-streamed batch)       │
  │                            │                             │
  │  event: tool_done          │                             │
  │  data: {"tool":"query..."}◄│                             │
  │                            │                             │
  │                            │  stream: true on final      │
  │                            │  Claude API call            │
  │                            ├────────────────────────────►│
  │                            │                             │
  │  event: text_delta         │                             │
  │  data: {"delta":"In the"}◄ │◄── stream chunks ───────────┤
  │                            │                             │
  │  event: text_delta         │                             │
  │  data: {"delta":" last"}◄  │◄── stream chunks ───────────┤
  │                            │        ...                  │
  │  event: done               │                             │
  │  data: {conversationId,    │                             │
  │         toolsUsed}        ◄│                             │
  │                            │                             │
  │  (connection closes)       │                             │
```

---

### 4.6 AWS Account Management

```
Client                          Express                    PostgreSQL
  │                                │                           │
  │  POST /api/aws-accounts        │                           │
  │  Authorization: Bearer <token> │                           │
  │  { name, roleArn,              │                           │
  │    makeDefault? }              │                           │
  ├───────────────────────────────►│                           │
  │                                │  authenticate middleware  │
  │                                │  → req.user.sub = userId  │
  │                                │                           │
  │                                │  Zod validate:            │
  │                                │  roleArn must match       │
  │                                │  /^arn:aws:iam::\d{12}:   │
  │                                │    role\/[\w+=,.@/-]+$/   │
  │                                │                           │
  │                                │  addAccount(userId,       │
  │                                │    name, roleArn,         │
  │                                │    makeDefault)           │
  │                                │                           │
  │                                │  withTransaction:         │
  │                                │  if makeDefault=true:     │
  │                                │    UPDATE aws_accounts    │
  │                                │    SET is_default=false   │
  │                                │    WHERE user_id=$1       │
  │                                │                           │
  │                                │  if isFirstAccount:       │
  │                                │    is_default=true auto   │
  │                                │                           │
  │                                │  INSERT aws_accounts      │
  │                                ├──────────────────────────►│
  │                                │◄──────────────────────────┤
  │                                │  new account row          │
  │                                │                           │
  │  201 { account: {              │                           │
  │    id, userId, name,           │                           │
  │    roleArn, isDefault,         │                           │
  │    createdAt }                 │                           │
  │  }                             │                           │
  │◄───────────────────────────────┤                           │
```

---

### 4.7 Claude Agentic Tool Loop

```
                    ┌─────────────────────────────────────────────┐
                    │           runCopilotQuery()                  │
                    │                                              │
                    │  Load conversation history from PostgreSQL   │
                    │  Append new user message                     │
                    │                                              │
                    │         ┌──────────┐                         │
                    │         │  LOOP    │                         │
                    │         └────┬─────┘                         │
                    │              │                               │
                    │   POST /messages to Claude API               │
                    │   { model, system, tools, messages[] }       │
                    │              │                               │
                    │              ▼                               │
                    │     stop_reason?                             │
                    │              │                               │
                    │    ┌─────────┴──────────┐                   │
                    │    │                    │                    │
                    │  "end_turn"         "tool_use"               │
                    │    │                    │                    │
                    │    ▼                    ▼                    │
                    │  Extract text     Extract all               │
                    │  block            tool_use blocks            │
                    │    │                    │                    │
                    │    │             Promise.all(tools)          │
                    │    │             [parallel execution]        │
                    │    │                    │                    │
                    │    │             dispatchTool(name,          │
                    │    │             input, awsCreds)            │
                    │    │                    │                    │
                    │    │             ┌──────┴────────┐           │
                    │    │             │               │           │
                    │    │     query_failed_jobs  get_redis_stats  │
                    │    │     (PostgreSQL)       (Redis INFO)     │
                    │    │                               │         │
                    │    │             get_aws_costs     │         │
                    │    │             (Cost Explorer,   │         │
                    │    │              STS creds)       │         │
                    │    │                    │          │         │
                    │    │             Append tool       │         │
                    │    │             results to        │         │
                    │    │             messages[]        │         │
                    │    │                    │          │         │
                    │    │             ◄──────┴──────────┘         │
                    │    │             Continue LOOP               │
                    │    │                                         │
                    │    ▼                                         │
                    │  Save to DB                                  │
                    │  Return { reply, toolsUsed, conversationId } │
                    └─────────────────────────────────────────────┘
```

**Infinite loop guard:** If `stop_reason` is neither `end_turn` nor `tool_use`, the loop breaks immediately and returns a safe error message.

---

### 4.8 STS AssumeRole with Redis Cache

```
   Request arrives with userId + accountId
              │
              ▼
   Redis GET sts:{userId}:{accountId}
              │
      ┌───────┴───────┐
      │               │
   HIT ✓           MISS ✗
      │               │
      │      STS AssumeRole API call
      │      RoleSessionName: "devops-copilot-{userId[:8]}"
      │      DurationSeconds: 3600 (1 hour)
      │               │
      │      Extract: AccessKeyId,
      │              SecretAccessKey,
      │              SessionToken,
      │              Expiration
      │               │
      │      TTL = (Expiration - now) - 60s
      │      (60s buffer prevents using
      │       near-expired credentials)
      │               │
      │      Redis SETEX sts:{userId}:{accountId}
      │               │
      ▼               ▼
   Return AssumedCredentials
   { accessKeyId, secretAccessKey, sessionToken }
              │
              ▼
   Injected into CostExplorerClient
   per-request (not global)
```

**On account deletion:** `invalidateStsCache(userId, accountId)` immediately deletes the Redis key — cached credentials are evicted synchronously.

---

## 5. Database Schema

```sql
-- Background job tracking
jobs (
  id            UUID PK  DEFAULT gen_random_uuid()
  name          VARCHAR(255) NOT NULL
  status        VARCHAR(50)  CHECK IN ('pending','running','failed','completed')
  error_message TEXT
  created_at    TIMESTAMPTZ  DEFAULT NOW()
  updated_at    TIMESTAMPTZ  DEFAULT NOW()
)
INDEX: (status, created_at DESC)

-- Conversation sessions
conversations (
  id         UUID PK
  created_at TIMESTAMPTZ
  updated_at TIMESTAMPTZ
)
INDEX: (updated_at DESC)

-- Chat messages within a conversation
messages (
  id              UUID PK
  conversation_id UUID FK → conversations(id) ON DELETE CASCADE
  role            VARCHAR(20) CHECK IN ('user', 'assistant')
  content         TEXT NOT NULL
  tools_used      TEXT[]   -- array of tool names used in that turn
  created_at      TIMESTAMPTZ
)
INDEX: (conversation_id, created_at ASC)

-- Authenticated users
users (
  id            UUID PK
  email         VARCHAR(255) UNIQUE NOT NULL
  password_hash TEXT NOT NULL        -- bcrypt cost 12
  role          VARCHAR(20) CHECK IN ('user', 'admin')  DEFAULT 'user'
  last_login_at TIMESTAMPTZ
  created_at    TIMESTAMPTZ
  updated_at    TIMESTAMPTZ
)
UNIQUE INDEX: email

-- AWS IAM Role ARNs per user (no long-lived credentials stored)
aws_accounts (
  id         UUID PK
  user_id    UUID FK → users(id) ON DELETE CASCADE
  name       VARCHAR(255) NOT NULL
  role_arn   TEXT NOT NULL           -- arn:aws:iam::ACCOUNT:role/NAME
  is_default BOOLEAN DEFAULT false
  created_at TIMESTAMPTZ
  updated_at TIMESTAMPTZ
  UNIQUE (user_id, name)
)
PARTIAL UNIQUE INDEX: (user_id) WHERE is_default = true
INDEX: (user_id)
```

---

## 6. Security Model

### 6.1 Authentication

| Mechanism          | Detail                                                                                                                                           |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Access Token**   | HS256 JWT, 15-minute TTL, signed with `JWT_SECRET` (min 32 chars), transmitted in response body (in-memory storage recommended)                  |
| **Refresh Token**  | HS256 JWT, 7-day TTL, signed with separate `JWT_REFRESH_SECRET`, transmitted as `httpOnly; secure; sameSite=strict` cookie scoped to `/api/auth` |
| **Token Rotation** | Every `/api/auth/refresh` call issues a new pair and revokes the old one                                                                         |
| **Redis Storage**  | Only `SHA-256(refreshToken)` stored in Redis — raw token never persisted anywhere                                                                |
| **Logout**         | Deletes the Redis hash key immediately; subsequent refresh calls return 401                                                                      |

### 6.2 Password Security

| Aspect                  | Implementation                                                                                                                 |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **Hashing**             | bcrypt, cost factor **12** (~300ms/hash)                                                                                       |
| **Constant-time login** | When email not found, a dummy bcrypt hash is still compared — prevents timing attacks that leak whether an email is registered |
| **Length limits**       | Min 8, max 128 characters validated by Zod                                                                                     |

### 6.3 AWS Credential Security

| Aspect                 | Implementation                                                                              |
| ---------------------- | ------------------------------------------------------------------------------------------- |
| **Storage**            | `role_arn` only stored in DB — **no** access keys, **no** secret keys                       |
| **Short-lived creds**  | STS `AssumeRole` with 3600s duration; cached in Redis with 60s buffer                       |
| **Scope**              | Credentials are per-user, per-account, per-request — injected into SDK client, never global |
| **Cache invalidation** | Account deletion immediately deletes the Redis STS cache key                                |

### 6.4 Transport & Headers

| Header / Policy | Value                                                                                                          |
| --------------- | -------------------------------------------------------------------------------------------------------------- |
| **Helmet**      | Sets `X-Content-Type-Options`, `X-Frame-Options`, `Strict-Transport-Security`, `Content-Security-Policy`, etc. |
| **CORS**        | `http://localhost:4200` in dev; `ALLOWED_ORIGIN` env var in prod; `credentials: true`                          |
| **Body size**   | `express.json({ limit: '10kb' })` — prevents large payload attacks                                             |
| **Request IDs** | `randomUUID()` via `AsyncLocalStorage` — every request traceable in logs                                       |

### 6.5 Rate Limiting

| Limiter              | Production      | Development   | Applied to    |
| -------------------- | --------------- | ------------- | ------------- |
| `generalRateLimiter` | 100 req/15min   | 500 req/15min | All routes    |
| `authRateLimiter`    | **5 req/15min** | 50 req/15min  | `/api/auth/*` |
| `chatRateLimiter`    | 20 req/15min    | 100 req/15min | `/api/chat`   |

### 6.6 Input Validation

Every external input boundary is validated with **Zod** before any processing:

- `RegisterSchema` — email format, password length 8–128
- `LoginSchema` — email format
- `ChatRequestSchema` — message 1–2000 chars, optional UUID fields
- `AddAccountSchema` — name 1–100 chars, Role ARN regex `^arn:aws:iam::\d{12}:role\/[\w+=,.@/-]{1,64}$`
- `envSchema` — all environment variables at startup (process exits if any fail)

### 6.7 SQL Injection Prevention

All database queries use **parameterized placeholders** (`$1`, `$2`, ...) — string interpolation into SQL is never used.

### 6.8 RBAC

| Role                  | Capabilities                                                           |
| --------------------- | ---------------------------------------------------------------------- |
| `user`                | Chat, manage own AWS accounts, view own profile                        |
| `admin`               | All user capabilities + `requireRole('admin')` guarded routes (future) |
| First registered user | Automatically promoted to `admin`                                      |

---

## 7. Rate Limiting

Rate limit details returned in `RateLimit-*` response headers (RFC 6585):

```
RateLimit-Limit: 5
RateLimit-Remaining: 4
RateLimit-Reset: 1744800000
```

When exceeded:

```json
HTTP 429
{
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Too many attempts. Please try again later."
  }
}
```

---

## 8. Environment Variables

| Variable                 | Required | Default                 | Description                                                                         |
| ------------------------ | -------- | ----------------------- | ----------------------------------------------------------------------------------- |
| `NODE_ENV`               | No       | `development`           | `development` / `production` / `test`                                               |
| `PORT`                   | No       | `3000`                  | Express listen port                                                                 |
| `DATABASE_URL`           | **Yes**  | —                       | PostgreSQL connection string                                                        |
| `REDIS_URL`              | **Yes**  | —                       | Redis connection string                                                             |
| `ANTHROPIC_API_KEY`      | **Yes**  | —                       | Anthropic API key                                                                   |
| `AWS_REGION`             | No       | `us-east-1`             | AWS region for STS                                                                  |
| `AWS_ACCESS_KEY_ID`      | **Yes**  | —                       | IAM credentials for the STS AssumeRole _caller_                                     |
| `AWS_SECRET_ACCESS_KEY`  | **Yes**  | —                       | IAM credentials for the STS AssumeRole _caller_                                     |
| `ALLOWED_ORIGIN`         | No       | `http://localhost:4200` | CORS allowed origin in production                                                   |
| `JWT_SECRET`             | **Yes**  | —                       | HS256 signing secret for access tokens (min 32 chars)                               |
| `JWT_REFRESH_SECRET`     | **Yes**  | —                       | HS256 signing secret for refresh tokens (min 32 chars, must differ from JWT_SECRET) |
| `MCP_POSTGRES_HTTP_PORT` | No       | `3001`                  | Postgres MCP server HTTP port                                                       |
| `MCP_REDIS_HTTP_PORT`    | No       | `3002`                  | Redis MCP server HTTP port                                                          |
| `MCP_AWS_HTTP_PORT`      | No       | `3003`                  | AWS MCP server HTTP port                                                            |

Generate secure JWT secrets:

```bash
node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"
```

---

## 9. Error Hierarchy

```
AppError (base)
├── DatabaseError      500  DATABASE_ERROR
├── McpToolError       500  MCP_TOOL_ERROR
├── ValidationError    400  VALIDATION_ERROR
├── NotFoundError      404  NOT_FOUND
├── AuthError          401  UNAUTHORIZED
└── ForbiddenError     403  FORBIDDEN
```

All errors produce a consistent JSON shape:

```json
{
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Invalid or expired access token",
    "requestId": "6b47322e-510b-427b-9745-f37aa7be1f9b"
  }
}
```

Internal errors (stack traces, DB details) are **never** sent to the client.

---

## 10. API Reference (summary)

See [openapi.yaml](./openapi.yaml) for the full Swagger/OpenAPI 3.1 specification.

| Method   | Path                    | Auth   | Description              |
| -------- | ----------------------- | ------ | ------------------------ |
| `GET`    | `/health`               | None   | Liveness check           |
| `POST`   | `/api/auth/register`    | None   | Create account           |
| `POST`   | `/api/auth/login`       | None   | Login, receive tokens    |
| `POST`   | `/api/auth/refresh`     | Cookie | Rotate token pair        |
| `POST`   | `/api/auth/logout`      | Cookie | Revoke refresh token     |
| `GET`    | `/api/auth/me`          | Bearer | Current user profile     |
| `GET`    | `/api/aws-accounts`     | Bearer | List linked AWS accounts |
| `POST`   | `/api/aws-accounts`     | Bearer | Link new AWS IAM role    |
| `DELETE` | `/api/aws-accounts/:id` | Bearer | Remove linked account    |
| `POST`   | `/api/chat`             | Bearer | Synchronous AI query     |
| `POST`   | `/api/chat/stream`      | Bearer | SSE streaming AI query   |
