# Runbook Compiler — Plan

## Top-Level Overview

**Goal:** Build a *Runbook Compiler* — a reusable AI workflow that reads
`docs/release-runbook.pdf`, compiles it into a `release-gate.yaml` config and a
set of executable check modules specific to *this* repo, and documents any gaps.
The compiler itself is an AI-assisted authoring step; the produced artifacts
(`release-gate.yaml` and `scripts/release-check/`) run entirely without AI.

**What the compiler produces:**
1. `release-gate.yaml` — one gate per runbook step, each annotated with status
   (`auto`, `manual`, `blocked`)
2. `scripts/release-check/` — one check module per automatable step, each proving
   the *full* requirement (not a proxy)
3. `docs/gap-report.md` — a record of requirements the repo cannot yet satisfy

**What the compiler does NOT do:**
- Modify any application code (`src/`, `test/`, `migrations/`)
- Produce sign-off files, release-engineer mode, or attestation workflows (cut)
- Run the checks itself — it only authors them

**Scope of new/changed files:**
- New: `.bob/custom_modes.yaml` (workspace mode)
- New: `.bob/skills/compile-runbook/SKILL.md`
- New: `release-gate.yaml`
- New: `scripts/release-check/index.js` + `checks/*.js`
- New: `docs/gap-report.md`
- Changed: `package.json` — one new `scripts` entry (`release-check`)
- Changed: `package.json` — one new `devDependencies` entry (`yaml`)

---

## Runbook Step Classification

Compiled from `docs/release-runbook.pdf` against the repo as it exists today:

| Step | Requirement (exact text, abbreviated) | Status | Rationale |
|------|---------------------------------------|--------|-----------|
| 1 | CI is green on main; head SHA matches local HEAD | auto | GitHub REST API; `git rev-parse HEAD` |
| 2 | Version bumped in `package.json`; CHANGELOG entry under that version | auto | File parse |
| 3 | `DATABASE_URL`, `JWT_SECRET`, `LOG_LEVEL` present for target env | auto | `process.env` presence check; values never printed |
| 4 | Pending migrations ran cleanly on staging | auto | Simulated staging: app boots on random port against fresh temp DB |
| 5 | `GET /health` returns 200 *and* DB is reachable | auto | Simulated staging; parse response body for DB signal |
| 6 | Smoke suite covers login, create shift, list shifts; all pass | auto | Simulated staging; assert all three flows present and passing |
| 7 | Image built and tagged with version from `package.json`; not `latest` | auto | `docker build` + `docker inspect`; BLOCKED if Docker unavailable |
| 8 | Container does not run as root | auto | `docker inspect` `Config.User`; same build as Step 7, separate result |
| 9 | `releases/PREVIOUS_TAG` exists, is tracked, committed, valid tag format, differs from candidate | auto | `git status` + format regex + version compare |
| 10 | Watch production dashboard 15 min; roll back if 5xx > 2% | MANUAL | Post-deploy; no programmatic equivalent |

**Simulated staging:** Steps 4, 5, 6 boot the app in-process on a random port against a
fresh temp SQLite database (same pattern as `test/shifts.test.js`). If `STAGING_URL` is set
in the environment it is used instead, and the label changes to "external staging". No
`STAGING_URL` requirement; no exit-2 on absence.

**Steps 7 & 8 share one Docker build** but produce independent result objects — separate
lines in both console output and the JSON file.

---

## Sub-Tasks

---

### Sub-Task 1: `runbook-compiler` mode and `compile-runbook` skill

**Intent:** These two artifacts are the AI-assisted authoring layer. The mode focuses the
agent on compilation work only (no app code changes). The skill contains the full
step-by-step procedure the mode follows, including the two parallel subagent invocations.
They must be created first because the skill's procedure generates all downstream artifacts.

**Expected Outcomes:**

**Mode** (`.bob/custom_modes.yaml`):
- Slug: `runbook-compiler`
- Name: `Runbook Compiler`
- `roleDefinition`: The agent reads a PDF runbook and compiles it into a `release-gate.yaml`,
  check modules, and a gap report for this specific repo. It never edits application code.
- `whenToUse`: "Use when you want to compile a release runbook PDF into executable release gates."
- Groups: `read`, `edit` (restricted to `release-gate\.yaml|scripts/release-check/.*|docs/gap-report\.md`),
  `skill`, `subagent`, `todo`
- No `execute` group — the mode authors files; it does not run them.

**Skill** (`.bob/skills/compile-runbook/SKILL.md`):
- Description trigger: "Use when the user wants to compile a release runbook PDF into
  executable release gates, check scripts, and a gap report."
- Body procedure (see Todo List below for the ordered steps the skill encodes).

**Skill procedure (what SKILL.md encodes):**

1. Read the PDF with `read_file`; extract each numbered step as a requirement object:
   `{ step, text, source_page }`. The exact PDF text is the authority — do not paraphrase.
2. Spawn two `explore` subagents **in parallel** (`fork_context: false`):
   - **Step Mapper**: For each requirement, locate the repo files, routes, scripts, and
     commands that relate to it. Return a mapping of `step → { files[], routes[], scripts[], commands[] }`.
   - **Gap Analyst**: For each requirement, assess whether the repo can satisfy it today.
     Return `step → { satisfiable: bool, evidence: string, gap: string|null }`.
3. Reconcile both results. For each step: determine status (`auto`/`manual`/`blocked`),
   select the check module name, and draft the gate entry.
4. Write `release-gate.yaml` (see Sub-Task 2 schema).
5. Write one check module per automatable step under `scripts/release-check/checks/`
   (see Sub-Task 3).
6. Write `docs/gap-report.md` (see Sub-Task 5).

**Constraint:** The skill must instruct the agent that it must not touch `src/`, `test/`,
or `migrations/`. If a gap requires an app change, record it in the gap report only.

**Relevant Context:**
- Mode file: `.bob/custom_modes.yaml` — workspace scope, no `settings/` subdirectory
- Skill file: `.bob/skills/compile-runbook/SKILL.md`
- Mode schema: slug regex `^[a-zA-Z0-9-]+$`; groups must be exact names from the
  allowed list (`read`, `edit`, `execute`, `skill`, `subagent`, `todo`, etc.)
- `fileRegex` for edit group must compile as a valid regex; use `|` alternation

**Status:** `[x] done`

---

### Sub-Task 2: `release-gate.yaml`

**Intent:** The single source of truth read by both the AI skill and the no-AI runner.
It is a *compiled output* of the skill run, not hand-authored. It is immutable at
runtime — neither `npm run release-check` nor any check module writes to it.

**Expected Outcomes:**
- `release-gate.yaml` at the repo root, parseable by the `yaml` npm package.
- One entry per runbook step, in step order.
- Each entry carries the exact requirement text from the PDF as `requirement`.
- Auto gates include `check` (module name) and `params`.
- Manual gates include `prompt` (verbatim from PDF) and `post_deploy: true` for Step 10.
- The BLOCKED status is used only when the repo structurally cannot support automation
  (not when a tool like Docker is merely absent at runtime — that is a runtime BLOCKED
  returned by the check module itself).

**Gate schema:**

```yaml
version: "1"
gates:
  # auto gate
  - id: <snake_case>
    step: <int>
    status: auto
    requirement: "<exact PDF text>"
    check: <module_name>        # maps to scripts/release-check/checks/<module_name>.js
    params:                     # optional
      key: value

  # manual gate
  - id: <snake_case>
    step: <int>
    status: manual
    requirement: "<exact PDF text>"
    prompt: "<question for operator>"
    post_deploy: true           # only for step 10
```

**Relevant Context:**
- `docs/release-runbook.pdf` — exact requirement text for each gate's `requirement` field
- `.env.example` — canonical env var names for Step 3 gate params

**Status:** `[ ] pending`

---

### Sub-Task 3: `scripts/release-check/` — runner and check modules

**Intent:** The AI-free `npm run release-check` command. The entry point reads
`release-gate.yaml` (via the `yaml` npm package), runs every `status: auto` gate in
order, emits human-readable console output and a JSON results file, then exits.

**Expected Outcomes:**

**Entry point** (`scripts/release-check/index.js`):
- Reads and parses `release-gate.yaml` using `require('yaml')`.
- Runs `status: auto` gates only, sequentially, in declaration order.
- `${ENV_VAR}` substitution applied to all param string values.
- Tracks per-check duration with `Date.now()`.
- After all checks: writes `release-check-results.json` to repo root.
- Emits human-readable console output (one line per step; see Output below).
- Exits 0 only if every auto gate returns PASS. Exits 1 if any gate FAILs or BLOCKs.

**Console output format:**
```
Step 1  ci_green             PASS   847ms  run #112 sha=abc1234 matches local HEAD
Step 2  version_changelog    PASS    12ms  1.4.0 found in CHANGELOG.md
Step 3  config_vars          PASS     3ms  DATABASE_URL JWT_SECRET LOG_LEVEL all present
Step 7  docker_image_tagged  BLOCKED  --   Docker daemon not reachable
Step 8  non_root_container   BLOCKED  --   Docker daemon not reachable (see Step 7)
Step 10 post_deploy_watch    MANUAL   --   (post-deploy; run separately)
─────────────────────────────────────────────────────────────────
4 PASS  0 FAIL  2 BLOCKED  1 MANUAL   total 3.2s   EXIT 1
```

**JSON results file** (`release-check-results.json`):
```json
{
  "version": "1.4.0",
  "ran_at": "<ISO 8601>",
  "total_ms": 3200,
  "gates": [
    {
      "id": "ci_green",
      "step": 1,
      "status": "PASS",
      "detail": "run #112 sha=abc1234 matches local HEAD",
      "duration_ms": 847
    },
    {
      "id": "docker_image_tagged",
      "step": 7,
      "status": "BLOCKED",
      "detail": "Docker daemon not reachable",
      "duration_ms": 0
    },
    {
      "id": "post_deploy_watch",
      "step": 10,
      "status": "MANUAL",
      "detail": "(post-deploy; run separately)",
      "duration_ms": 0
    }
  ],
  "summary": {
    "pass": 4,
    "fail": 0,
    "blocked": 2,
    "manual": 1,
    "exit_code": 1
  }
}
```

**Exit codes:** 0 = every auto gate PASS; 1 = any FAIL or BLOCKED; (no exit 2 — env errors
are BLOCKED results, not process errors).

**`package.json` changes:**
- Add `"release-check": "node --disable-warning=ExperimentalWarning scripts/release-check/index.js"`
  to `scripts`.
- Add `"yaml": "^2.0.0"` to `devDependencies`.

**Check modules** (`scripts/release-check/checks/<name>.js`):

Each exports `module.exports = async function run(params, env) { }` and returns
`{ status: 'PASS'|'FAIL'|'BLOCKED', detail: string }`. No uncaught exceptions.

| Module | Step | Full requirement to prove | Logic |
|--------|------|--------------------------|-------|
| `ci_green.js` | 1 | CI is green on main **and** head SHA matches local HEAD | (1) `git rev-parse HEAD` → local SHA. (2) Derive repo owner/name from `git remote get-url origin`. (3) GET `https://api.github.com/repos/{owner}/{repo}/actions/runs?branch=main&per_page=1`; use `GITHUB_TOKEN` env if present for auth. (4) Assert `workflow_runs[0].conclusion === 'success'`. (5) Assert `workflow_runs[0].head_sha === localSHA`. BLOCKED if network unreachable. |
| `version_changelog.js` | 2 | Version bumped in `package.json`; CHANGELOG entry under that exact version | Read `package.json` `version`; assert `CHANGELOG.md` contains `## {version}` heading. FAIL if either missing. |
| `config_vars.js` | 3 | `DATABASE_URL`, `JWT_SECRET`, `LOG_LEVEL` are set for the target environment | Assert each var is present in `process.env`. Log names only, never values. FAIL if any absent. |
| `migrations_staging.js` | 4 | Pending migrations ran cleanly | If `STAGING_URL` set: spawn `npm run migrate` with `DATABASE_URL` from env, assert exit 0. Otherwise: create temp SQLite file, run `scripts/migrate.js` programmatically, assert no error. Label result "simulated staging" or "external staging". |
| `health_check_staging.js` | 5 | `GET /health` returns 200 **and** DB is reachable (plain 200 is not enough) | Boot app locally on random port (same pattern as `test/shifts.test.js`) if `STAGING_URL` absent. `fetch('/health')`; assert status 200; assert response body contains a signal that DB is reachable (parse body; the step text says "report that the database is reachable"). FAIL if status is 200 but body does not confirm DB. |
| `smoke_tests.js` | 6 | Smoke suite covers the three flows and all pass: login, create shift, list shifts | Boot app + migrate (or use `STAGING_URL`). Run all three flows directly (not by shelling `npm run smoke` — `smoke.js` currently covers only login and list; the check must assert all three per the requirement). FAIL if any of the three flows fails or if create-shift flow is absent. |
| `docker_image_tagged.js` | 7 | Image built and tagged with version from `package.json`; never `latest` | Read `package.json` version. On non-win32: `sh scripts/build-image.sh`. On win32: `docker build -t shiftboard-api:{version} .`. BLOCKED if Docker daemon unreachable. FAIL if build exits non-zero. FAIL if resulting tag equals `latest`. |
| `non_root_container.js` | 8 | Container must not run as root | Depends on Step 7 build result (check modules are independent; this check re-reads the same image via `docker inspect shiftboard-api:{version}`). BLOCKED if Docker unreachable. FAIL if `Config.User` is empty, `root`, or `0`. |
| `rollback_file.js` | 9 | `releases/PREVIOUS_TAG` exists, is git-tracked, is committed (clean), contains a valid tag format, and differs from the candidate version | (1) Assert file exists. (2) `git ls-files releases/PREVIOUS_TAG` → non-empty. (3) `git status --porcelain releases/PREVIOUS_TAG` → empty (committed, not dirty). (4) Assert content matches semver-ish tag regex (`v?\d+\.\d+\.\d+.*`). (5) Read `package.json` version; assert `PREVIOUS_TAG` content differs. |

**Note on Step 6 gap:** `scripts/smoke.js` currently covers login and list-shifts but not
create-shift. The `smoke_tests.js` check must implement the three flows inline (not
delegate to `smoke.js`) and will FAIL against the current repo until `smoke.js` is updated
or the check is considered authoritative. This gap is recorded in `docs/gap-report.md`.

**Note on Step 5:** The existing `src/routes/health.js` must be inspected at implementation
time to confirm what the `/health` response body looks like, so the check can assert the DB
signal correctly.

**Relevant Context:**
- `test/shifts.test.js` — pattern for booting app on random port with temp DB (lines 7-9,
  `before` hook)
- `scripts/smoke.js` — covers login + list, not create-shift
- `scripts/migrate.js` — programmatic migration runner
- `src/routes/health.js` — must be read before implementing `health_check_staging.js`
- `scripts/build-image.sh` — shell script called on non-Windows platforms
- `scripts/record-previous-tag.js` — writes `releases/PREVIOUS_TAG`

**Status:** `[ ] pending`

---

### Sub-Task 4: `releases/` directory bootstrap

**Intent:** The `rollback_file` check requires `releases/PREVIOUS_TAG` to exist and be
git-tracked. A `.gitkeep` ensures the directory itself is tracked before any release is
recorded.

**Expected Outcomes:**
- `releases/.gitkeep` committed to repo.
- `releases/PREVIOUS_TAG` is created by the operator before first use via
  `npm run record:previous-tag -- <tag>` and committed — the gap report documents this.
- The `rollback_file.js` check's FAIL message for missing file says:
  "releases/PREVIOUS_TAG not found; run: npm run record:previous-tag -- <previous-tag>"

**Relevant Context:**
- `scripts/record-previous-tag.js` — creates the file at `releases/PREVIOUS_TAG`

**Status:** `[ ] pending`

---

### Sub-Task 5: `docs/gap-report.md`

**Intent:** Document every requirement the repo cannot fully satisfy today, so the team
has a clear remediation list. Written by the `runbook-compiler` mode as part of the
compile step; not updated by `npm run release-check`.

**Expected Outcomes:**
- `docs/gap-report.md` exists after a compile run.
- One section per gap, each containing: the step number, the exact requirement text, the
  gap description, the file evidence used to identify it, and a suggested remediation.
- The document is non-normative — it does not block `npm run release-check`.

**Known gaps at plan time** (to be confirmed by the Gap Analyst subagent at compile time):

| Step | Gap | Suggested Remediation |
|------|-----|-----------------------|
| 6 | `scripts/smoke.js` covers login + list-shifts only; create-shift flow is missing | Add create-shift flow to `smoke.js` |
| 9 | `releases/PREVIOUS_TAG` does not exist yet | Operator runs `npm run record:previous-tag` before first release |

**Format:**

```markdown
# Gap Report — shiftboard-api Release Runbook

Generated by runbook-compiler on {date}.
Source: docs/release-runbook.pdf (doc version 3.2)

## Step N — {title}

**Requirement:** "{exact PDF text}"

**Gap:** {description of what the repo cannot satisfy}

**Evidence:**
- `{file}:{line}` — {note}

**Suggested remediation:** {what to change}
```

**Status:** `[ ] pending`

---

## Architecture

```
.bob/
  custom_modes.yaml              <- runbook-compiler mode
  skills/
    compile-runbook/
      SKILL.md                   <- compiler procedure (subagents, reconcile, write)

docs/
  release-runbook.pdf            <- input (read-only)
  gap-report.md                  <- compiler output

release-gate.yaml                <- compiler output; runner input (immutable at runtime)

releases/
  .gitkeep
  PREVIOUS_TAG                   <- operator-written; checked by rollback_file.js

scripts/
  release-check/
    index.js                     <- AI-free runner; reads release-gate.yaml via `yaml` pkg
    checks/
      ci_green.js                <- Step 1: GitHub REST API + local SHA
      version_changelog.js       <- Step 2: file parse
      config_vars.js             <- Step 3: env var presence
      migrations_staging.js      <- Step 4: migrate against temp DB or STAGING_URL
      health_check_staging.js    <- Step 5: /health body parse for DB signal
      smoke_tests.js             <- Step 6: three flows inline
      docker_image_tagged.js     <- Step 7: build + tag assertion
      non_root_container.js      <- Step 8: docker inspect Config.User
      rollback_file.js           <- Step 9: five assertions on PREVIOUS_TAG

package.json                     <- +devDependencies.yaml, +scripts.release-check
```

**Compiler data flow (AI, one-time):**

```
docs/release-runbook.pdf
         │
         ▼
  runbook-compiler mode
  (compile-runbook skill)
         │
         ├── read_file(PDF) → 10 requirement objects
         │
         ├── spawn_subagent(Step Mapper)   ─┐  parallel
         ├── spawn_subagent(Gap Analyst)   ─┘
         │
         ├── reconcile → gate statuses + check designs
         │
         ├── write release-gate.yaml
         ├── write scripts/release-check/index.js
         ├── write scripts/release-check/checks/*.js  (9 files)
         └── write docs/gap-report.md
```

**Runner data flow (no AI, repeatable):**

```
npm run release-check
         │
         ▼
  index.js reads release-gate.yaml (yaml pkg)
         │
         ├── ci_green.js         → PASS/FAIL/BLOCKED
         ├── version_changelog.js → PASS/FAIL
         ├── config_vars.js       → PASS/FAIL
         ├── migrations_staging.js → PASS/FAIL/BLOCKED
         ├── health_check_staging.js → PASS/FAIL/BLOCKED
         ├── smoke_tests.js       → PASS/FAIL/BLOCKED
         ├── docker_image_tagged.js → PASS/FAIL/BLOCKED
         ├── non_root_container.js → PASS/FAIL/BLOCKED
         ├── rollback_file.js     → PASS/FAIL
         │   [step 10 skipped: status=manual]
         │
         ├── console output (one line per step + summary)
         └── release-check-results.json
```

---

## Decisions Recorded

| Topic | Decision |
|-------|----------|
| CI check mechanism | GitHub REST API; derive repo from `git remote get-url origin`; use `GITHUB_TOKEN` if present; no `gh` CLI |
| CI green definition | Latest run on main: `conclusion === 'success'` AND `head_sha === local HEAD` |
| Staging | App boots in-process on random port with fresh temp DB (same pattern as test suite); `STAGING_URL` optional override; no exit-2 on absence |
| Config var check | Assert presence in `process.env`; names only in output, never values |
| Step 7 & 8 | Share one Docker build; produce two independent result objects |
| Docker BLOCKED | Runtime unavailability → BLOCKED (not FAIL); BLOCKED exits 1 |
| YAML parsing | `yaml` npm package added to `devDependencies` |
| Sign-off files | Cut |
| `release-engineer` mode | Cut |
| Step 10 | MANUAL gate; post-deploy; never counted in runner pass result |
| Exit code 0 | Only if every auto gate is PASS (BLOCKED or FAIL → exit 1) |
| Rollback file validity | Must exist + git-tracked + committed + valid tag format + differs from candidate version |
| Windows compatibility | `docker_image_tagged.js` detects `process.platform === 'win32'` and avoids `sh` |
