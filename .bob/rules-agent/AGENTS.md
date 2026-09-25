# Project Coding Rules (Non-Obvious Only)

- Use `node:sqlite` (`DatabaseSync`) for all DB access — **no ORM, no query builder**. Call `getDb()` from [`src/db.js`](../../src/db.js); never instantiate `DatabaseSync` directly.
- `hashPassword(password, salt)` is exported from [`src/routes/auth.js`](../../src/routes/auth.js) and reused in [`scripts/migrate.js`](../../scripts/migrate.js) — keep the signature stable.
- All modules use CommonJS (`require`/`module.exports`). Do NOT use `import`/`export`.
- Error response shape is always `{ error: '<snake_case_code>' }` — no human-readable messages in the JSON body.
- `createApp()` must remain a pure factory (no side effects at module load time) so tests can call it after setting env vars.
- New SQL migrations go in `migrations/` as `NNN_description.sql`; the runner picks them up automatically by filename sort order.
- `JWT_SECRET` is required at runtime and will throw on first login attempt if missing — do not add a fallback default.
