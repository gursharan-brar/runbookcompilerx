Independent verification of docs/code-review.md (written by IBM Bob, Task 06). Written by Claude Code, not Bob.

# Review verification — docs/code-review.md

Each of the 14 findings in the review's summary table was checked against the code at commit `21c8dcd`. Result: 8 confirmed, 5 overstated, 1 wrong. None of the four known gate weaknesses listed below were found by the review.

## Findings

| # | Finding | Verdict | Evidence |
|---|---|---|---|
| 1 | health.js: caught DB exception not logged | **CONFIRMED** | `src/routes/health.js:10-11`: `catch (e)` returns 503 and never uses `e`. |
| 2 | health.js: 503 uses `db: 'error'`, not `'unreachable'` | **CONFIRMED** | `health.js:11` returns `'error'`; `docs/gap-report.md:17` suggests `'unreachable'`. That was a suggested remediation, not a spec. |
| 3 | server.js: `LOG_LEVEL` hard-required, breaks deployments (**High**) | **OVERSTATED** | It is now required (`src/server.js:3-8`), and the `\|\| 'info'` at `:12` can no longer take effect. But Step 3 (`release-gate.yaml:18`) already makes `LOG_LEVEL` mandatory for prod, so any deployment that passes the gate has it set. Low, not High. |
| 4 | Empty `LOG_LEVEL=` passes the gate but kills the server | **WRONG** | `scripts/release-check/checks/config_vars.js:11` uses `!env[name]`, the same test as `server.js:4`, so an empty string fails both. The review's own §2.2 says so. |
| 5 | smoke.js: `create shift` failure message misleading after `login` fails | **CONFIRMED** (minor) | `scripts/smoke.js:18,35` sends `Bearer undefined`. The `FAIL login` line prints first (`:15`), so the cause is still visible. |
| 6 | smoke.js: smoke shift row stays in staging DB | **CONFIRMED**, `STAGING_URL` runs only | `smoke_tests.js:30` points `BASE_URL` at staging and `smoke.js:33-41` never deletes the row. On local runs the temp DB is deleted (`smoke_tests.js:126-128`). |
| 7 | health_check: race between `getFreePort` and server bind (**Medium**) | **OVERSTATED** | The race exists (`health_check_staging.js:73` finds a port, `:86` passes it on), but the window on localhost is tiny. The review misdescribes it: the server is launched with `spawn` (`:77-78`), not `spawnSync`. If another process grabbed the port, `waitForPort` would succeed against that process rather than time out. Low. |
| 8 | health_check: `JWT_SECRET` fallback masks a missing secret | **OVERSTATED** | The fallback exists (`:64`, `:85`), but Step 3 fails in the same run and `index.js:91,105` fails the whole gate. "If checks run independently" doesn't apply: `index.js` always runs them all. |
| 9 | smoke_tests: no kill for a stuck subprocess on Windows | **OVERSTATED** | There is a 60 s timeout (`smoke_tests.js:68`). With `shell: true` (`:70`) it kills `cmd.exe`, so an orphaned node process is possible. But the review contradicts itself: it says `spawnSync` "unblocks", then says the whole gate blocks. It also cites SIGTERM, which Windows doesn't use. |
| 10 | smoke_tests: output parser fragile | **CONFIRMED** (Low) | ANSI colour codes would break `^\s+PASS\s+(.+)$` (`:86`), and a missed line is reported as "did not run" (`:108`). The §4.5 heading says "exact leading whitespace", but the body correctly says any whitespace matches. |
| 11 | ci_green: an in-progress re-run blocks PASS | **CONFIRMED** | `.find()` at `ci_green.js:65` takes the first run with a matching SHA, and `:76` fails it if still running. The comment at `:64` says "latest completed", but nothing filters on that. Fails safe (FAIL, not a false PASS). |
| 12 | rollback_file: semver regex not end-anchored | **CONFIRMED** | `rollback_file.js:12` has no `$`, so `1.0.0garbage` and multi-line content pass. |
| 13 | config_vars: `LOG_LEVEL` value not validated | **CONFIRMED** | `config_vars.js:11` only checks that it's present, so `LOG_LEVEL=garbage` passes. |
| 14 | index.js: YAML parser drops mis-indented entries | **CONFIRMED** | `index.js:33` requires exactly 4 spaces and `:25` exactly 2. A gate whose `status:` line is dropped is in neither list (`:59-60`) and vanishes; the only sign is the "N auto" count in the header. |

**Errors in sections outside the table:** §4.3 is **wrong**. It says a 200 response with `db: 'error'` would pass, but `'error' !== 'ok'`, so `health_check_staging.js:121-129` returns FAIL. §2.1 and §2.2 contradict each other on the empty-string case (row 4).

## Gate weaknesses the review missed

| Weakness | Found? | Evidence |
|---|---|---|
| 1. Step 1 ignores a dirty working tree | **Missed** | `ci_green.js:11` only compares the HEAD SHA; nothing runs `git status`. Only Step 9 checks cleanliness, and only for `releases/PREVIOUS_TAG`. The review's §4.6 covers `ci_green` but only the in-progress issue. |
| 2. Step 4 migrates a temp DB, not `data/staging.db` | **Missed** | The review never looks at `migrations_staging.js`. `:47-48` creates a temp DB and ignores `DATABASE_URL=file:./data/staging.db`, so the Step 4 PASS says nothing about staging. Steps 5 and 6 also use temp DBs (`health_check_staging.js:55`, `smoke_tests.js:34`). |
| 3. Step 5 would accept a hardcoded `db` field | **Missed** | `health_check_staging.js:121-127` accepts any 200 response with `db: 'ok'`, and no check exercises the failure path, so `res.json({status:'ok', db:'ok'})` with no probe would pass. §4.3 is the nearest the review gets, and its claim there is wrong. §1.1 says the fix "matches every branch of the gate check". |
| 4. Step 6 parses output and ignores the exit code | **Missed** | `smoke_tests.js` checks `result.error` (`:73`) but never `result.status`. §4.4 and §4.5 are about the timeout and the regex. This is the gap that lets the known Windows crash (exit -1073740791) still pass. |

## Other observation

When `STAGING_URL` is set, Step 4 passes it in as `DATABASE_URL` (`migrations_staging.js:21`). Steps 5 and 6 treat the same variable as an HTTP base URL (`health_check_staging.js:52`, `smoke_tests.js:30`). Both can't be right. It does not affect local gate runs, where `STAGING_URL` is unset.
