## Description

<!-- A brief summary of what this PR does and why. -->

Closes #<!-- issue number, if applicable -->

---

## Type of change

- [ ] `feat` — New feature
- [ ] `fix` — Bug fix
- [ ] `docs` — Documentation only
- [ ] `refactor` — No behaviour change
- [ ] `test` — Tests only
- [ ] `chore` — Build, deps, or tooling

---

## Checklist

### Code quality

- [ ] `npm run typecheck` passes with zero errors
- [ ] No `any` type introduced — used `unknown` for uncertain types
- [ ] No `console.log` / `console.error` in `src/` — used `pino` logger
- [ ] All external inputs validated with Zod
- [ ] SQL queries use parameterized form (`$1`, `$2`, …) — no string interpolation

### Stack constraints

- [ ] Built-in imports use `node:` prefix (`node:crypto`, `node:fs/promises`, …)
- [ ] No `dotenv`, `ts-node`, `aws-sdk` v2, or `redis` package introduced
- [ ] MCP tool handlers return `{ isError: true }` — they do not throw

### Tests

- [ ] `npm test` passes
- [ ] New code paths are covered (tool handlers, error branches)

### Commit

- [ ] Commit title follows Conventional Commits: `<type>(scope): description`

---

## How to test

<!-- Step-by-step instructions for a reviewer to verify the change works. -->

1.
2.
3.

---

## Screenshots / logs

<!-- Optional — paste relevant pino log output, curl responses, or screenshots. Remove any secrets first. -->
