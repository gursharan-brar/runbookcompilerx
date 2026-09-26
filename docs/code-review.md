# Code Review — commit 21c8dcd

Reviewed against: `docs/gap-report.md`, `scripts/release-check/checks/`

---

## 1. `src/routes/health.js`

### 1.1 Gap satisfied — correctly
The gap required `GET /health` to probe the database and return a field indicating
reachability. The fix executes `SELECT 1` via the `getDb()` singleton and returns
`{ status: 'ok', db: 'ok' }` on success and HTTP 503 with `{ status: 'error',
db: 'error' }` on failure. This matches every branch of the gate check in
`health_check_staging.js` (which accepts `body.db === 'ok'`).

### 1.2 Correctness: exception value discarded
```js
} catch (e) {
  res.status(503).json({ status: 'error', db: 'error' });
}
```
The caught exception `e` is silently swallowed. If the database is broken the
operator has no server-side log entry explaining why. The fix should log `e`
(e.g. `console.error('health db probe failed', e)`) before returning 503. This
does not affect gate pass/fail but it is an operational blind spot.

### 1.3 Correctness: `db: 'error'` diverges from gap-report suggestion
The gap report suggested `{ status: 'error', db: 'unreachable' }` on failure.
The fix returns `db: 'error'`. This is not a gate problem (the gate only checks
the `200`/`db === 'ok'` path), but it is inconsistent with the documented
specification. Neither string is machine-actionable without coupling to a specific
literal, so the inconsistency should at minimum be noted.

### 1.4 Security: error details not leaked — acceptable
The 503 body does not include the SQLite error message or stack trace. That is the
correct behaviour; no issue here.

---

## 2. `src/server.js`

### 2.1 New `LOG_LEVEL` requirement is a breaking env change
`server.js` now adds `LOG_LEVEL` to its `required` array and calls `process.exit(1)`
if it is absent. The `AGENTS.md` table marks `LOG_LEVEL` with default `info`, and
`createApp()` (via the startup banner) reads `process.env.LOG_LEVEL || 'info'`.
Making it a hard exit requirement is more strict than the application actually needs:
the app works fine without it. Any existing deployment that does not set `LOG_LEVEL`
will now fail to start after this release.

**Gate impact:** `config_vars.js` checks for `LOG_LEVEL` in `env`; it now aligns
with `server.js`. However, the gate only checks that the variable is *present* (truthy
check `!env[name]`), not that it has a valid value. Setting `LOG_LEVEL=` (empty
string) passes the gate but still causes `server.js` to exit because `''` is falsy.
The gate will pass while the server will refuse to start — a false PASS.

### 2.2 `LOG_LEVEL` checked with falsy test, not `in` operator
```js
const missing = required.filter(v => !process.env[v]);
```
An empty string `LOG_LEVEL=` is falsy and triggers exit, but the gate in
`config_vars.js` uses the same pattern (`!env[name]`) so they are consistent in
this respect. Still, the combined behaviour means an operator who exports
`LOG_LEVEL=` will be rejected at server start while the gate reports PASS.

### 2.3 No `JWT_SECRET` strength check
`server.js` verifies `JWT_SECRET` is set but not that it has adequate entropy. A
one-character secret passes the gate and starts the server. The gate (`config_vars.js`)
has the same gap. This is a pre-existing issue not introduced by this commit, but the
commit touched `server.js` without addressing it.

---

## 3. `scripts/smoke.js`

### 3.1 Gap satisfied — correctly
The gap required a `create shift` flow (`POST /shifts`, assert 201). The fix adds
the flow in the correct position (before `list shifts`), uses the authenticated
`token` from the `login` flow, and sends a valid payload. The output line
`  PASS  create shift` will now appear and match `smoke_tests.js`'s `REQUIRED_FLOWS`
constant.

### 3.2 Correctness: `create shift` depends on `login` implicitly
If `login` fails, `token` is `undefined`. The `create shift` check will then receive
a `Bearer undefined` authorization header, which the API will reject with 401.
`smoke.js` will report `FAIL create shift: expected 201, got 401` rather than
skipping the dependent check. The gate interprets any FAIL as a failure, which is
correct, but the failure message is misleading — it implies an auth issue rather than
a cascade from login. This is a pre-existing pattern carried over from `list shifts`
and not new to this commit, but the new flow inherits the same weakness.

### 3.3 Correctness: response body of `POST /shifts` not verified
The check asserts HTTP 201 but does not inspect the response body (e.g. confirm an
`id` field is present). A 201 with an empty or malformed body would silently pass
smoke. The runbook only requires the three flows to "pass", and a 201 status is a
reasonable proxy, but a minimal body assertion would provide stronger signal.

### 3.4 Correctness: smoke worker row left in DB after run
`POST /shifts` inserts a row with `worker: 'smoke-worker'`. When `BASE_URL` is not
set, `smoke.js` boots the app against a temp SQLite file and `server.close()` cleans
up the process, but the gate runner in `smoke_tests.js` creates its own temp DB and
does not delete it until the `finally` block. This is fine for ephemeral local runs.
When `BASE_URL` / `STAGING_URL` is set, the smoke shift row is written to the live
staging database and never cleaned up. Depending on staging data hygiene policies
this may be undesirable.

---

## 4. Gate checks — `scripts/release-check/checks/`

### 4.1 `health_check_staging.js` — race between `getFreePort` and server bind
The check calls `getFreePort()` (which opens and immediately closes a listening
socket to discover a free port) and then passes that port to `spawnSync`-launched
`server.js`. Between the two calls the OS can re-assign the port to another process.
The `waitForPort` retry loop will recover if the server eventually binds, but if
another process occupies the port the server will exit and `waitForPort` will return
BLOCKED after 15 s. This is an inherent TOCTOU race in the port-discovery pattern;
the correct approach is to let the OS choose the port by passing `PORT=0` and reading
it from the process's stdout — which `server.js` does not currently expose.

### 4.2 `health_check_staging.js` — `JWT_SECRET` fallback bypasses `config_vars` intent
When `STAGING_URL` is not set the check injects `JWT_SECRET: env.JWT_SECRET || 'tmp-secret'`.
This means the check can PASS even when `JWT_SECRET` is absent from the caller's
environment. `config_vars.js` would fail in the same situation. If checks run
independently (or in isolation), `health_check_staging` could report PASS while
`config_vars` reports FAIL on the same environment — inconsistent gate outcomes for
the same root cause.

### 4.3 `health_check_staging.js` — `db: 'error'` body treated as non-reachable
The gate's reachability predicate checks `body.db === 'ok'`. The fix returns
`db: 'error'` on 503. Because the gate only evaluates the `dbReachable` path on a
200 response (the 503 is caught by the `res.status !== 200` check first), this is
actually fine in practice. However if a future change returns 200 with `db: 'error'`
the gate would silently PASS — there is no explicit guard for `db === 'error'` that
returns FAIL.

### 4.4 `smoke_tests.js` — no timeout guard on npm subprocess
`spawnSync('npm', ['run', 'smoke'], { timeout: 60_000 })` kills the child at 60 s,
but `spawnSync` on Windows does not propagate `SIGTERM` to sub-processes. The `smoke.js`
child may hang indefinitely while `spawnSync` itself unblocks. The gate runner has no
overall timeout, so one stuck smoke run can block the entire gate suite.

### 4.5 `smoke_tests.js` — output parser requires exact leading whitespace
The regex `^\s+PASS\s+(.+)$` matches any leading whitespace. `smoke.js` emits
`  PASS  create shift` (two spaces, PASS, two spaces, name). If `smoke.js` output
format ever changes (e.g. colour codes from a future npm script wrapper), the regex
silently misses the line and the gate FAILs with a misleading "did not run" message
instead of a parse error.

### 4.6 `ci_green.js` — first matching run is used, not the latest completed run
```js
const matchingRun = runsData.workflow_runs.find(r => r.head_sha === localSHA);
```
`.find()` returns the first element in API order. The GitHub API returns runs newest
first, so this is typically the latest run for that SHA — but the code does not
filter by `status === 'completed'` before matching. If the most recent run for the
SHA is still in progress (status `in_progress`) `.find()` returns it, and the check
then returns FAIL with `"status is not completed"`. A completed, successful run for
the same SHA that appears later in the list would be ignored. A release that should
PASS can be blocked by a re-triggered in-progress run.

### 4.7 `rollback_file.js` — semver regex anchored at start only
```js
const SEMVER_RE = /^([^:]+:)?v?\d+\.\d+\.\d+/;
```
The regex has no `$` anchor. A file containing `1.0.0-dirty-hack` or
`shiftboard-api:1.0.0\nmalicious-second-line` matches and the gate reports PASS. The
pattern should be anchored: `/^([^:]+:)?v?\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?(\+[a-zA-Z0-9.]+)?$/`.

### 4.8 `config_vars.js` — `LOG_LEVEL` presence check does not validate value
The check asserts `!!env.LOG_LEVEL` but any non-empty string passes (e.g.
`LOG_LEVEL=garbage`). The application does not crash on an unknown log level (it is
only printed in the startup banner), but an invalid value indicates a misconfigured
deployment. A whitelist assertion (`['debug','info','warn','error'].includes(env.LOG_LEVEL)`)
would make the gate more meaningful.

### 4.9 `index.js` — YAML parser silently drops gates with nested or quoted fields
The hand-rolled YAML parser in `index.js` is fragile. It matches gate fields only via
`/^    (\w+):\s*(.*)/` (exactly four leading spaces, word-only keys). A field like
`check: "my-check"` with surrounding quotes would have its quotes stripped, but a
field indented differently (e.g. three or five spaces due to editor config) would
be silently discarded, effectively making the gate disappear from the auto-run list
without any warning.

---

## Summary

| Area | Severity | Issue |
|---|---|---|
| `health.js` | Low | Caught DB exception not logged |
| `health.js` | Low | 503 body uses `db: 'error'`, not `db: 'unreachable'` per spec |
| `server.js` | **High** | `LOG_LEVEL` now hard-required — breaks existing deployments without it |
| `server.js` | Medium | Empty `LOG_LEVEL=` passes gate but kills server at start |
| `smoke.js` | Low | `create shift` failure message misleading when `login` failed first |
| `smoke.js` | Low | Smoke shift row persists in staging DB permanently |
| `health_check_staging.js` | Medium | TOCTOU race between `getFreePort` and server bind |
| `health_check_staging.js` | Medium | `JWT_SECRET` fallback masks missing-secret misconfiguration |
| `smoke_tests.js` | Medium | No kill for stuck subprocess on Windows |
| `smoke_tests.js` | Low | Output parser fragile against format changes |
| `ci_green.js` | Medium | In-progress re-run for same SHA blocks PASS on completed run |
| `rollback_file.js` | Medium | Semver regex not end-anchored — allows garbage suffixes |
| `config_vars.js` | Low | `LOG_LEVEL` value not validated against known levels |
| `index.js` | Low | Hand-rolled YAML parser silently drops mis-indented gate entries |
