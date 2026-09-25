# AGENTS.md

This file provides guidance to agents when working with code in this repository.

## Stack

- Node.js ≥ 22.13, CommonJS (`require`/`module.exports`) throughout — no ESM
- Express 4, `jsonwebtoken`, **no ORM**: raw SQL via Node's built-in `node:sqlite` (`DatabaseSync`)
- No TypeScript, no linter config, no formatter config

## Commands

```
npm test                   # run all tests (Node built-in test runner)
npm run migrate            # apply pending SQL migrations + seed demo user
npm run smoke              # smoke test against local app (or BASE_URL env var)
npm start                  # start server (PORT env, default 3000)
```

**Run a single test by name** (Node test runner filter flag):
```
node --disable-warning=ExperimentalWarning --test --test-name-pattern="creates and lists a shift"
```

All test files live in `test/` but tests must set `DATABASE_URL` and `JWT_SECRET` env vars **before** requiring any app modules — the module-level singleton in [`src/db.js`](src/db.js) opens the DB on first `require`, so env must be set first (see [`test/shifts.test.js:7-9`](test/shifts.test.js)).

## Architecture

- [`src/app.js`](src/app.js) — factory `createApp()`, used by both server and tests (no singleton side-effect)
- [`src/db.js`](src/db.js) — module-level singleton `db`; `DATABASE_URL` must be set before first import
- [`src/routes/auth.js`](src/routes/auth.js) — exports `{ router, requireAuth, hashPassword }`; `hashPassword` is also used by migrate script
- [`migrations/`](migrations/) — plain `.sql` files; `scripts/migrate.js` tracks applied ones in `schema_migrations` table and seeds `demo@shiftboard.dev / demo-password`

## Critical Patterns

- **Error responses use snake_case string codes**, not messages: `{ error: 'worker_starts_at_ends_at_required' }`
- **Passwords**: `crypto.scryptSync` with a per-user `salt` column; never store plaintext
- **Auth**: JWT signed with `JWT_SECRET` env var, 1h expiry; `requireAuth` middleware attaches `req.user = { sub, email }`
- **DB WAL mode** is set on every open — don't override `PRAGMA journal_mode`
- `role` field on shifts is optional (nullable); all other shift fields are required
- `starts_at` / `ends_at` stored as ISO 8601 TEXT strings, not integers

## Environment Variables

| Variable | Default | Notes |
|---|---|---|
| `DATABASE_URL` | `file:./data/shiftboard.db` | `file:` prefix required |
| `JWT_SECRET` | *(none — crashes without it)* | Must be set before starting |
| `PORT` | `3000` | |
| `LOG_LEVEL` | `info` | Logged in startup banner only |
