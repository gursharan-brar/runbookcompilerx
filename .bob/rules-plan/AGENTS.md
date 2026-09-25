# Project Architecture Rules (Non-Obvious Only)

- **DB singleton opens at first `require`**: `src/db.js` caches the `DatabaseSync` instance at module level. Tests must set `DATABASE_URL` before importing any app module or they share the production DB path.
- **Migrations are forward-only**: `scripts/migrate.js` wraps each SQL file in a transaction and records it in `schema_migrations`. There is no rollback mechanism.
- **`createApp()` factory is the seam for testing**: the server (`src/server.js`) and all tests call `createApp()` separately — never require `src/server.js` from tests.
- **No middleware abstraction layer**: auth middleware (`requireAuth`) lives in `src/routes/auth.js` and is applied per-router in `src/app.js`. Adding new protected routes requires explicit `auth.requireAuth` in `app.js`.
- `role` is the only nullable column on `shifts`; any new optional fields should follow the same `|| null` pattern on insert.
