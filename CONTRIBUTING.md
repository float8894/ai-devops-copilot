# Contributing to AI DevOps Copilot

Thank you for your interest in contributing! This document covers everything you need to know.

---

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Branch Naming](#branch-naming)
- [Commit Messages](#commit-messages)
- [Pull Request Process](#pull-request-process)
- [Reporting Bugs](#reporting-bugs)
- [Suggesting Features](#suggesting-features)

---

## Code of Conduct

Be respectful. Harassment, personal attacks, and discriminatory language will not be tolerated.

---

## Getting Started

1. **Fork** the repository on GitHub
2. **Clone** your fork: `git clone https://github.com/<your-username>/ai-devops-copilot.git`
3. Add the upstream remote: `git remote add upstream https://github.com/abhishekpanchal/ai-devops-copilot.git`

---

## Development Setup

### Prerequisites

- Node.js 24+
- Docker (for PostgreSQL + Redis via `docker-compose`)
- An [Anthropic API key](https://console.anthropic.com)

### Steps

```bash
cd backend
npm install

# Start PostgreSQL + Redis
docker compose up -d

# Copy and fill in env vars
cp .env.example .env
# Edit .env with your keys

# Run in dev mode
npm run dev
```

See [backend/SETUP.md](./backend/SETUP.md) for detailed setup instructions.

### Tech stack constraints

The stack is intentional — please do not introduce:

| Prohibited | Use instead |
|-----------|------------|
| `ts-node` | `tsx` |
| `dotenv` package | `node --env-file` |
| `console.log` in `src/` | `pino` logger |
| `any` TypeScript type | `unknown` |
| AWS SDK v2 | `@aws-sdk/*` v3 modular |
| `redis` package | `ioredis` |
| NestJS | Express |

---

## Branch Naming

```
feat/<short-description>      # New feature
fix/<short-description>       # Bug fix
docs/<short-description>      # Documentation only
refactor/<short-description>  # No behaviour change
test/<short-description>      # Tests only
chore/<short-description>     # Build, deps, tooling
```

---

## Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(scope): short description

Optional longer body explaining the why.
```

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`

Examples:
```
feat(auth): add JWT refresh token rotation
fix(sts): prevent using near-expired cached credentials
docs(openapi): document SSE event types
```

---

## Pull Request Process

1. Branch from `main` (not `feature/*` branches)
2. Make sure `tsc --noEmit` passes with zero errors
3. Make sure tests pass: `npm test`
4. Keep PRs focused — one feature/fix per PR
5. Fill in the PR template describing what changed and why
6. A maintainer will review within a few days

---

## Reporting Bugs

Open a [GitHub Issue](../../issues/new) and include:

- What you did
- What you expected
- What actually happened
- Node.js version (`node --version`)
- Relevant log output (redact any secrets)

---

## Suggesting Features

Open a [GitHub Issue](../../issues/new) with the `enhancement` label. Describe:

- The problem you're solving
- Your proposed solution
- Any alternatives you considered
