# Security Architecture — AI DevOps Copilot

> This document is a deep-dive into every security control in the system.
> Reference the main [README.md](./README.md) for flow diagrams and component overview.

---

## Table of Contents

1. [Threat Model](#1-threat-model)
2. [AWS Credential Security](#2-aws-credential-security)
3. [Transport Security](#3-transport-security)
4. [Input Validation & Injection Prevention](#4-input-validation--injection-prevention)
5. [Rate Limiting](#5-rate-limiting)
6. [Data Storage Security](#6-data-storage-security)
7. [Error Handling & Information Leakage](#7-error-handling--information-leakage)
8. [Dependency Security](#8-dependency-security)
9. [OWASP Top 10 Mapping](#9-owasp-top-10-mapping)
10. [Secrets Management](#10-secrets-management)

---

## 1. Threat Model

### Assets

| Asset                       | Sensitivity | Location                         |
| --------------------------- | ----------- | -------------------------------- |
| AWS STS session credentials | High        | In-memory only (never persisted) |
| Conversation history        | Medium      | PostgreSQL (`messages` table)    |
| Pino structured logs        | Low         | stdout (no secrets logged)       |

### Threat Actors

| Actor                    | Capability       | Primary vectors                                      |
| ------------------------ | ---------------- | ---------------------------------------------------- |
| Unauthenticated attacker | Internet access  | Large payloads, rate limit abuse, injection attempts |
| MITM                     | Network position | Intercept API traffic in transit                     |
| Insider                  | DB/Redis access  | Read conversation history, job data                  |

---

## 2. AWS Credential Security

### What is stored vs. what is not

| Data                     | Stored in DB | In-memory only | Transmitted to client |
| ------------------------ | ------------ | -------------- | --------------------- |
| AWS Access Key ID        | ❌ Never     | ✅ Via env var | ❌ Never              |
| AWS Secret Access Key    | ❌ Never     | ✅ Via env var | ❌ Never              |
| STS Session Token (temp) | ❌ Never     | ✅ 59 min max  | ❌ Never              |

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

## 3. Transport Security

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

## 4. Input Validation & Injection Prevention

### Request Body Validation

Every public-facing input is validated with **Zod** before any database or API call:

```
ChatRequestSchema → message 1-2000 chars, optional uuid conversationId
envSchema         → all env vars at startup (process.exit on failure)
```

### SQL Injection Prevention

All PostgreSQL queries use parameterized placeholders — **never** string interpolation:

```typescript
// ✅ Safe — parameterized
await query('SELECT * FROM jobs WHERE status = $1', [status]);

// ❌ Forbidden — never in this codebase
await db.query(`SELECT * FROM jobs WHERE status = '${status}'`);
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

## 5. Rate Limiting

### Rate Limit Strategy

Two separate limiters:

```
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

---

## 6. Data Storage Security

### PostgreSQL

| Data                 | Stored as | Notes                               |
| -------------------- | --------- | ----------------------------------- |
| Role ARNs            | Plaintext | They're resource names, not secrets |
| Conversation content | Plaintext | Stored for history recall           |
| Job error messages   | Plaintext | Source of truth for job failures    |

**Access control:** The application connects as a single database user (`copilot`) with CRUD permissions only. No DDL in application code.

### Redis

Redis is used for rate limit state only. No secrets or user data are stored in Redis.

---

## 7. Error Handling & Information Leakage

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
- STS credential details

### Logging

Pino structured logging records:

- `requestId` on every log line
- `err.type`, `err.message` (not full stack) in error logs
- Tool names and conversation IDs

Logs deliberately exclude: AWS credentials, Claude API keys.

---

## 8. Dependency Security

### Key Security-Relevant Dependencies

| Package              | Version | Security function |
| -------------------- | ------- | ----------------- |
| `helmet`             | ^8      | Security headers  |
| `express-rate-limit` | ^7      | Rate limiting     |
| `zod`                | ^4      | Input validation  |

### What is not used (and why)

| Package         | Avoided because                                             |
| --------------- | ----------------------------------------------------------- |
| `jsonwebtoken`  | Not needed — no JWT auth in this project                    |
| `bcrypt`        | Not needed — no password storage                            |
| `aws-sdk` (v2)  | Deprecated; all-or-nothing import bloat                     |
| `dotenv`        | Use `node --env-file` native flag instead                   |
| `redis` package | `ioredis` has better reconnect logic and TypeScript support |

---

## 9. OWASP Top 10 Mapping

| OWASP 2021                    | Risk                              | Mitigation in this project                                          |
| ----------------------------- | --------------------------------- | ------------------------------------------------------------------- |
| A01 Broken Access Control     | Unrestricted endpoint access      | Rate limiting; Zod validation; parameterized queries                |
| A02 Cryptographic Failures    | Secrets in plaintext              | All secrets in env vars only; TLS in production                     |
| A03 Injection                 | SQL injection                     | 100% parameterized queries; Zod validation; no string interpolation |
| A04 Insecure Design           | No rate limiting, no validation   | Rate limiting; body size limits; strict Zod schemas                 |
| A05 Security Misconfiguration | Missing headers, open CORS        | Helmet; CORS locked to specific origin; env schema validation       |
| A06 Vulnerable Components     | Outdated deps                     | Modular AWS SDK v3; regular `npm audit`                             |
| A07 Auth Failures             | N/A — no auth in this project     | N/A                                                                 |
| A08 Software Integrity        | Supply chain                      | npm lockfile; no `any` TypeScript; no dynamic `require`             |
| A09 Logging Failures          | Missing audit trail               | Pino on every request; requestId correlation                        |
| A10 SSRF                      | External requests from user input | AWS SDK handles endpoint resolution; user input never used as URL   |

---

## 10. Secrets Management

### Current Implementation (Development)

Secrets are loaded via `node --env-file=.env`. The file is in `.gitignore` — never committed.

### Production Recommendations

| Secret                                                     | Recommended storage                                                      |
| ---------------------------------------------------------- | ------------------------------------------------------------------------ |
| `ANTHROPIC_API_KEY`                                        | AWS Secrets Manager                                                      |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` (STS caller) | Use IAM Instance Profile / ECS Task Role instead — no static keys needed |
| `DATABASE_URL`                                             | AWS RDS IAM Auth or Secrets Manager                                      |

**Ideal production setup:** Deploy on ECS/EC2 with an IAM Task Role. Remove `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` from environment entirely — `@aws-sdk/client-cost-explorer` will use the instance metadata service automatically.
