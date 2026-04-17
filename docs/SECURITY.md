# Security Architecture — AI DevOps Copilot

> This document is a deep-dive into every security control in the system.
> Reference the main [README.md](./README.md) for flow diagrams and component overview.

---

## Table of Contents

1. [Threat Model](#1-threat-model)
2. [Authentication Deep Dive](#2-authentication-deep-dive)
3. [AWS Credential Security](#3-aws-credential-security)
4. [Transport Security](#4-transport-security)
5. [Input Validation & Injection Prevention](#5-input-validation--injection-prevention)
6. [Rate Limiting & Brute Force Protection](#6-rate-limiting--brute-force-protection)
7. [Data Storage Security](#7-data-storage-security)
8. [Error Handling & Information Leakage](#8-error-handling--information-leakage)
9. [Dependency Security](#9-dependency-security)
10. [OWASP Top 10 Mapping](#10-owasp-top-10-mapping)
11. [Secrets Management](#11-secrets-management)

---

## 1. Threat Model

### Assets

| Asset                       | Sensitivity | Location                             |
| --------------------------- | ----------- | ------------------------------------ |
| User passwords              | Critical    | PostgreSQL (`password_hash` bcrypt)  |
| JWT signing secrets         | Critical    | Environment variable only            |
| Refresh tokens              | High        | Redis (as SHA-256 hash only)         |
| AWS STS session credentials | High        | Redis (short-lived, in-memory only)  |
| IAM Role ARNs               | Medium      | PostgreSQL (`aws_accounts.role_arn`) |
| Conversation history        | Medium      | PostgreSQL (`messages` table)        |
| Pino structured logs        | Low         | stdout (no secrets logged)           |

### Threat Actors

| Actor                        | Capability           | Primary vectors                                               |
| ---------------------------- | -------------------- | ------------------------------------------------------------- |
| Unauthenticated attacker     | Internet access      | Brute-force login, registration spam, large payloads          |
| Authenticated malicious user | Valid JWT            | Access other users' data, abuse AWS cost queries              |
| Compromised client           | XSS in browser       | Steal access token from memory, CSRF against refresh endpoint |
| MITM                         | Network position     | Intercept tokens in transit                                   |
| Insider                      | DB/Redis read access | Read hashed passwords, Redis token hashes                     |

---

## 2. Authentication Deep Dive

### JWT Design Decisions

```
Access Token (15 min)
─────────────────────
Header:  { "alg": "HS256", "typ": "JWT" }
Payload: {
  "sub": "<userId UUID>",
  "email": "alice@example.com",
  "role": "user",
  "iat": <unix timestamp>,
  "exp": <unix timestamp + 900>
}
Signed with: JWT_SECRET (env var, min 32 chars)

Refresh Token (7 days)
──────────────────────
Header:  { "alg": "HS256", "typ": "JWT" }
Payload: {
  "sub": "<userId UUID>",
  "iat": <unix timestamp>,
  "exp": <unix timestamp + 604800>
}
Signed with: JWT_REFRESH_SECRET (separate secret, min 32 chars)
```

**Why two separate secrets?**  
If an attacker obtains `JWT_SECRET`, they can forge access tokens but **cannot** forge refresh tokens (different key). The blast radius of a single key compromise is halved.

**Why HS256 and not RS256?**  
This is a single-service backend — there are no other services that need to verify JWTs. Symmetric HS256 is faster and avoids key-pair management complexity. If a microservices architecture is adopted later, RS256 (asymmetric) should be adopted.

### Token Storage (Client Recommendations)

| Location              | Risks                                      | Recommendation                      |
| --------------------- | ------------------------------------------ | ----------------------------------- |
| `localStorage`        | XSS can steal token                        | ❌ Never                            |
| `sessionStorage`      | XSS can steal token                        | ❌ Never                            |
| In-memory JS variable | Lost on page refresh; XSS can't persist it | ✅ Recommended for access token     |
| httpOnly cookie       | XSS-proof; requires CSRF protection        | ✅ Refresh token always stored here |

### Refresh Token Security Chain

```
1. Server generates refresh token (random JWT)
2. SHA-256(token) stored in Redis as key
   Raw token → never stored server-side
3. Token sent to client as httpOnly cookie
4. On refresh:
   a. JWT signature verified (HS256)
   b. SHA-256(presented token) looked up in Redis
   c. Match required — prevents forged or revoked tokens
   d. Old key deleted atomically
   e. New token pair issued
5. On logout:
   Redis key deleted immediately
   Cookie cleared
```

**Token rotation detects theft:**  
If token T1 is stolen and an attacker uses it after the legitimate user already rotated to T2, T1's hash no longer exists in Redis → 401. The attacker is locked out. The legitimate user's T2 also becomes invalid (conservative design — requires re-login).

### Timing Attack Prevention

Login uses a **constant-time code path** regardless of whether the email exists:

```typescript
// When email NOT found — still runs bcrypt.compare against dummy hash
// This prevents an attacker from timing login to discover valid emails
const dummyHash =
  '$2a$12$invalidsaltinvalidsaltinvalidsaltinvalidsaltinvalidsal';
const valid =
  user !== null
    ? await verifyPassword(password, user.passwordHash)
    : await verifyPassword(password, dummyHash).then(() => false);
```

bcrypt.compare takes ~300ms regardless — this ensures both paths take approximately the same time.

---

## 3. AWS Credential Security

### What is stored vs. what is not

| Data                         | Stored in DB | Stored in Redis | Transmitted to client         |
| ---------------------------- | ------------ | --------------- | ----------------------------- |
| IAM Role ARN                 | ✅ Yes       | ❌ No           | ✅ Yes (it's a resource name) |
| AWS Access Key ID            | ❌ Never     | ❌ Never        | ❌ Never                      |
| AWS Secret Access Key        | ❌ Never     | ❌ Never        | ❌ Never                      |
| STS Access Key ID (temp)     | ❌ Never     | ✅ 59 min max   | ❌ Never                      |
| STS Secret Access Key (temp) | ❌ Never     | ✅ 59 min max   | ❌ Never                      |
| STS Session Token (temp)     | ❌ Never     | ✅ 59 min max   | ❌ Never                      |

### STS AssumeRole security properties

```
Server IAM Identity (long-lived)
  └── Has permission: sts:AssumeRole on user's roles
             │
             └──► Customer IAM Role (user's account)
                    Trust policy: { "Principal": { "AWS": "<server IAM>" } }
                    Permission: ce:GetCostAndUsage
                             │
                             └──► Short-lived credentials (1 hour)
                                    Cached in Redis for TTL-60 seconds
                                    Injected per-request into CostExplorerClient
                                    Never returned to client
```

**Principle of least privilege:**  
Each user's IAM role need only grant `ce:GetCostAndUsage` — no broader AWS access is required or requested.

**Session naming:**  
`RoleSessionName = "devops-copilot-{userId[:8]}"` — allows AWS CloudTrail to attribute API calls to a specific user's session.

---

## 4. Transport Security

### Helmet Headers Set

| Header                      | Value / Effect                                                      |
| --------------------------- | ------------------------------------------------------------------- |
| `Strict-Transport-Security` | `max-age=15552000; includeSubDomains` (HTTPS enforced for 180 days) |
| `X-Content-Type-Options`    | `nosniff` (prevents MIME-type sniffing)                             |
| `X-Frame-Options`           | `DENY` (prevents clickjacking)                                      |
| `Content-Security-Policy`   | Helmet default policy                                               |
| `X-XSS-Protection`          | Disabled (modern CSP is more effective)                             |
| `Referrer-Policy`           | `no-referrer`                                                       |

### CORS Policy

```
Development:
  Allow-Origin: http://localhost:4200 (Angular dev server)
  credentials: true (required for cookies)

Production:
  Allow-Origin: $ALLOWED_ORIGIN env var
  credentials: true

Unauthorized origins → 403 (no CORS headers returned)
```

### Cookie Security Attributes

The `refreshToken` cookie is set with:

```
Set-Cookie: refreshToken=<jwt>;
  HttpOnly           # JavaScript cannot read this cookie (XSS protection)
  Secure             # Only sent over HTTPS
  SameSite=Strict    # Never sent on cross-site requests (CSRF protection)
  Path=/api/auth     # Scoped — not sent to /api/chat, /api/aws-accounts, etc.
  Max-Age=604800     # 7 days
```

`SameSite=Strict` means a malicious page on another domain cannot trigger `/api/auth/refresh` even if the cookie exists — the browser won't attach it to cross-origin requests.

---

## 5. Input Validation & Injection Prevention

### Request Body Validation

Every public-facing input is validated with **Zod** before any database or API call:

```
RegisterSchema    → email format, password 8-128 chars
LoginSchema       → email format
ChatRequestSchema → message 1-2000 chars, optional uuid fields
AddAccountSchema  → name 1-100 chars, roleArn regex validation
envSchema         → all env vars at startup (process.exit on failure)
```

### SQL Injection Prevention

All PostgreSQL queries use parameterized placeholders — **never** string interpolation:

```typescript
// ✅ Safe — parameterized
await query('SELECT * FROM users WHERE email = $1', [email]);

// ❌ Forbidden — never in this codebase
await db.query(`SELECT * FROM users WHERE email = '${email}'`);
```

The `query<T>()` helper in `src/lib/database.ts` enforces this pattern throughout the codebase.

### Role ARN Validation

IAM Role ARNs are validated against a strict regex before storage:

```
/^arn:aws:iam::\d{12}:role\/[\w+=,.@/-]{1,64}$/
```

This prevents storing arbitrary strings that could cause unexpected behavior with AWS APIs.

### Body Size Limit

```typescript
express.json({ limit: '10kb' });
express.urlencoded({ extended: true, limit: '10kb' });
```

Prevents HTTP request body-size DoS attacks; 10KB is more than sufficient for any valid API request.

---

## 6. Rate Limiting & Brute Force Protection

### Rate Limit Strategy

Three separate limiters with different policies:

```
authRateLimiter (most restrictive)
  Window:     15 minutes
  Prod limit: 5 requests
  Dev limit:  50 requests
  Scope:      /api/auth/* (login, register, refresh, logout)
  Purpose:    Prevents brute-force attacks on credentials

chatRateLimiter
  Window:     15 minutes
  Prod limit: 20 requests
  Dev limit:  100 requests
  Scope:      /api/chat
  Purpose:    Prevents AI API cost abuse

generalRateLimiter
  Window:     15 minutes
  Prod limit: 100 requests
  Dev limit:  500 requests
  Scope:      All routes
  Purpose:    General DoS protection
```

### Rate Limit Response

Exceeded requests receive:

```
HTTP 429 Too Many Requests
RateLimit-Limit: 5
RateLimit-Remaining: 0
RateLimit-Reset: <epoch>
Retry-After: <seconds>

{
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Too many attempts. Please try again later."
  }
}
```

### Brute Force Mitigations (layered)

1. **Rate limiting** — 5 login attempts per 15 min per IP
2. **bcrypt cost 12** — ~300ms per attempt even if rate limit is bypassed
3. **Constant-time comparison** — doesn't leak email existence
4. **Generic error messages** — "Invalid email or password" (never splits the two)

---

## 7. Data Storage Security

### PostgreSQL

| Data                 | Stored as               | Notes                               |
| -------------------- | ----------------------- | ----------------------------------- |
| Passwords            | `bcrypt($password, 12)` | Never plaintext                     |
| Emails               | Plaintext               | Required for login lookup           |
| Role ARNs            | Plaintext               | They're resource names, not secrets |
| Conversation content | Plaintext               | Stored for history recall           |
| Job error messages   | Plaintext               | Source of truth for job failures    |

**Access control:** The application connects as a single database user (`copilot`) with CRUD permissions only. No DDL in application code.

### Redis

| Key pattern                | Value                     | TTL                    | Purpose                  |
| -------------------------- | ------------------------- | ---------------------- | ------------------------ |
| `refresh:{SHA-256(token)}` | `userId` string           | 604800s (7d)           | Refresh token validation |
| `sts:{userId}:{accountId}` | JSON `AssumedCredentials` | `(expiry - now) - 60s` | STS credential cache     |

**What is never stored in Redis:** raw tokens, passwords, access tokens.

---

## 8. Error Handling & Information Leakage

### Error Response Design

All errors return a consistent shape with **no internal details**:

```json
{
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Invalid or expired access token",
    "requestId": "6b47322e-510b-427b-9745-f37aa7be1f9b"
  }
}
```

The `requestId` allows correlation with server-side Pino logs **without revealing stack traces or DB query details** to the client.

### What is never returned to the client

- Stack traces
- Database error messages (e.g., query syntax, table names)
- Internal service error details
- Whether an email exists in the database
- STS credential details

### Logging

Pino structured logging records:

- `requestId` on every log line
- `userId` on auth events
- `err.type`, `err.message` (not full stack) in error logs
- Tool names and conversation IDs

Logs deliberately exclude: passwords, tokens, JWT payloads, AWS credentials.

---

## 9. Dependency Security

### Key Security-Relevant Dependencies

| Package               | Version | Security function                             |
| --------------------- | ------- | --------------------------------------------- |
| `jose`                | ^5      | ESM-native JWT — actively maintained, audited |
| `bcryptjs`            | ^2      | Pure-JS bcrypt — no native bindings, portable |
| `helmet`              | ^8      | Security headers                              |
| `express-rate-limit`  | ^7      | Rate limiting                                 |
| `@aws-sdk/client-sts` | v3      | AWS STS — modular, actively maintained        |
| `cookie-parser`       | ^1      | HTTP-only cookie parsing                      |
| `zod`                 | ^3      | Input validation                              |

### What is not used (and why)

| Package         | Avoided because                                             |
| --------------- | ----------------------------------------------------------- |
| `jsonwebtoken`  | CommonJS only; `jose` is more actively maintained           |
| `bcrypt`        | Requires native binaries — platform-specific build issues   |
| `aws-sdk` (v2)  | Deprecated; all-or-nothing import bloat                     |
| `dotenv`        | Use `node --env-file` native flag instead                   |
| `redis` package | `ioredis` has better reconnect logic and TypeScript support |

---

## 10. OWASP Top 10 Mapping

| OWASP 2021                    | Risk                                | Mitigation in this project                                          |
| ----------------------------- | ----------------------------------- | ------------------------------------------------------------------- |
| A01 Broken Access Control     | IAM misconfig, data leakage         | JWT + RBAC; user_id in every DB query; STS per-user isolation       |
| A02 Cryptographic Failures    | Weak password storage, plain tokens | bcrypt cost 12; SHA-256 for Redis keys; HS256 JWT; httpOnly cookies |
| A03 Injection                 | SQL injection                       | 100% parameterized queries; Zod validation; no string interpolation |
| A04 Insecure Design           | Token theft, CSRF                   | Token rotation; SameSite=Strict; separate refresh secret            |
| A05 Security Misconfiguration | Missing headers, open CORS          | Helmet; CORS locked to specific origin; env schema validation       |
| A06 Vulnerable Components     | Outdated deps                       | Modular AWS SDK v3; jose over jsonwebtoken                          |
| A07 Auth Failures             | Brute force, timing attacks         | 3-layer brute-force defense; constant-time login                    |
| A08 Software Integrity        | Supply chain                        | npm lockfile; no `any` TypeScript; no dynamic `require`             |
| A09 Logging Failures          | Missing audit trail                 | Pino on every request; requestId correlation; userId on auth events |
| A10 SSRF                      | External requests from user input   | Role ARN regex validation; no user-supplied URLs executed           |

---

## 11. Secrets Management

### Current Implementation (Development)

Secrets are loaded via `node --env-file=.env`. The file is in `.gitignore` — never committed.

### Environment Variable Security Rules

1. `JWT_SECRET` and `JWT_REFRESH_SECRET` must be **different** strings
2. Both must be **≥ 32 characters** (enforced by Zod at startup)
3. Generate with: `node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"`
4. The global shell `ANTHROPIC_API_KEY` takes precedence over `.env` — be aware if you export it in `~/.zshrc`

### Production Recommendations

| Secret                                                     | Recommended storage                                                      |
| ---------------------------------------------------------- | ------------------------------------------------------------------------ |
| `JWT_SECRET` / `JWT_REFRESH_SECRET`                        | AWS Secrets Manager or HashiCorp Vault                                   |
| `ANTHROPIC_API_KEY`                                        | AWS Secrets Manager                                                      |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` (STS caller) | Use IAM Instance Profile / ECS Task Role instead — no static keys needed |
| `DATABASE_URL`                                             | AWS RDS IAM Auth or Secrets Manager                                      |

**Ideal production setup:** Deploy on ECS/EC2 with an IAM Task Role that has `sts:AssumeRole` permission. Remove `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` from environment entirely — `@aws-sdk/client-sts` will use the instance metadata service automatically.
