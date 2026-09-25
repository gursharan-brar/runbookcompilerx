---
name: compile-runbook
description: >-
  Use when the user wants to compile a release runbook PDF into executable
  release gates, check scripts, and a gap report.
---

# Compile Runbook

Follow these steps in exact order. Do not skip or reorder steps. Update the
todo list at the start and after each step completes.

## Constraints (enforce throughout)

- You must NOT modify any file under `src/`, `test/`, or `migrations/`.
- If a requirement gap demands an application change, record it in
  `docs/gap-report.md` only — do not touch application code.
- The only files you may create or edit are:
  - `release-gate.yaml`
  - `scripts/release-check/index.js`
  - `scripts/release-check/checks/*.js`
  - `docs/gap-report.md`

---

## Step 1 — Initialise todo list

Call `update_todo_list` with these items before doing any other work:

```
[ ] Step 1: Initialise todo list
[ ] Step 2: Read PDF and extract requirements
[ ] Step 3: Run parallel subagents (Step Mapper + Gap Analyst)
[ ] Step 4: Reconcile results into gate designs
[ ] Step 5: Write release-gate.yaml
[ ] Step 6: Write scripts/release-check/checks/*.js (one per auto gate)
[ ] Step 7: Write docs/gap-report.md
```

Mark Step 1 complete once the list is created.

---

## Step 2 — Read the PDF and extract requirements

Use `read_file` on `docs/release-runbook.pdf`.

For every numbered step in the document create a requirement object with these
exact fields:

```json
{
  "step": <integer>,
  "text": "<exact verbatim text from PDF — do not paraphrase>",
  "source_page": <integer>
}
```

Store all requirement objects in memory as `requirements[]`. The PDF text is
the authority for the `requirement:` field that will appear in `release-gate.yaml`.

Mark Step 2 complete on the todo list.

---

## Step 3 — Spawn parallel subagents

Spawn **both** subagents in the **same tool-call turn** so they run in parallel.
Set `fork_context: false` for both. Do not wait for one before spawning the other.

### Subagent A — Step Mapper

**description:**

```
You are the Step Mapper for the shiftboard-api runbook compiler.

For each requirement below, locate every repo file, route, script, and CLI
command that directly relates to satisfying that requirement. Read the files
you need using read_file and grep.

Return a JSON array — one object per step — with this shape:
{
  "step": <int>,
  "files": ["<relative-path>", ...],
  "routes": ["<HTTP-method> <path>", ...],
  "scripts": ["<relative-path>", ...],
  "commands": ["<cli command>", ...]
}

Requirements:
<paste the full requirements[] array here as JSON>

Repo root: shiftboard-api
Key files to consult: src/app.js, src/db.js, src/routes/, scripts/, test/,
package.json, migrations/.
```

### Subagent B — Gap Analyst

**description:**

```
You are the Gap Analyst for the shiftboard-api runbook compiler.

For each requirement below, assess whether the repo can fully satisfy it today
using only files in the repo (no changes to src/, test/, or migrations/).

Return a JSON array — one object per step — with this shape:
{
  "step": <int>,
  "satisfiable": true | false,
  "evidence": "<file:line or observation that supports your assessment>",
  "gap": "<description of what is missing, or null if satisfiable>"
}

Requirements:
<paste the full requirements[] array here as JSON>

Repo root: shiftboard-api
Key files to consult: src/app.js, src/db.js, src/routes/, scripts/, test/,
package.json, migrations/, scripts/smoke.js, scripts/record-previous-tag.js.
```

Wait for both subagents to return before proceeding to Step 4.

Mark Step 3 complete on the todo list.

---

## Step 4 — Reconcile results into gate designs

For **each step** (1 through 10), combine the Step Mapper output and the Gap
Analyst output to produce a gate design object:

```json
{
  "step": <int>,
  "id": "<snake_case identifier>",
  "status": "auto" | "manual" | "blocked",
  "requirement": "<verbatim PDF text from Step 2>",

  // if status == "auto":
  "check": "<module filename without .js>",
  "params": { "<key>": "<value>" },   // omit if no params

  // if status == "manual":
  "prompt": "<question or instruction for the human operator>",
  "post_deploy": true                 // only if the step is explicitly post-deploy

  // gaps found:
  "gaps": [
    {
      "description": "<what the repo cannot satisfy>",
      "evidence": "<file:line>",
      "remediation": "<suggested fix>"
    }
  ]   // empty array if no gaps
}
```

### Status assignment rules

Apply **every condition** below in order; assign the first status that matches:

1. If the requirement is explicitly a post-deploy human action (no programmatic
   equivalent exists for it) → `manual`.
2. If the repo structurally cannot support automation even after applying all
   non-application-code changes (e.g. a required external service is
   architecturally absent) → `blocked`.
3. Otherwise → `auto`. Runtime tool unavailability (e.g. Docker not installed)
   is handled inside the check module as a runtime BLOCKED result — it does NOT
   make the gate `status: blocked` in the YAML.

### Check module naming

Use these exact module names for the automatable steps (map step → module name):

| Step | module name |
|------|-------------|
| 1 | `ci_green` |
| 2 | `version_changelog` |
| 3 | `config_vars` |
| 4 | `migrations_staging` |
| 5 | `health_check_staging` |
| 6 | `smoke_tests` |
| 7 | `docker_image_tagged` |
| 8 | `non_root_container` |
| 9 | `rollback_file` |

### Condition-by-condition check rule

For each gate design, explicitly list every distinct condition the check module
must verify. Do not collapse or summarise them. A check that proves only a proxy
(e.g. "file exists") when the requirement states multiple conditions (e.g.
"file exists AND is git-tracked AND is committed AND matches regex AND differs
from candidate") is a FAIL against the requirement. Record every condition as a
separate bullet. These bullets become the implementation contract for Step 6.

Mark Step 4 complete on the todo list.

---

## Step 5 — Write release-gate.yaml

Write `release-gate.yaml` to the repo root using `write_file`.

Use this exact schema (YAML 1.2, no tabs):

```yaml
version: "1"
gates:
  - id: <snake_case>
    step: <int>
    status: auto          # or manual
    requirement: "<exact verbatim PDF text>"
    check: <module_name>  # only for status: auto
    params:               # only if params are needed
      key: value
    prompt: "<operator question>"  # only for status: manual
    post_deploy: true              # only for post-deploy manual gates
```

Rules:
- One entry per step, in ascending step order.
- The `requirement:` value must be the verbatim PDF text from Step 2 — no
  paraphrasing.
- Do not include fields that do not apply (e.g. do not add `check:` to a manual
  gate; do not add `prompt:` to an auto gate).
- `status: blocked` is reserved for gates where the repo architecturally cannot
  support automation (this should be rare or absent for this repo; see Step 4
  status rules).

Mark Step 5 complete on the todo list.

---

## Step 6 — Write check modules

Write one file per automatable gate to `scripts/release-check/checks/<name>.js`.
Use `write_file` for each file.

### Module contract

Every check module must:

```js
// scripts/release-check/checks/<name>.js
module.exports = async function run(params, env) {
  // ...
  return { status: 'PASS' | 'FAIL' | 'BLOCKED', detail: '<string>' };
};
```

- `params` is the `params` object from the gate's YAML entry (already env-var
  substituted by the runner).
- `env` is `process.env` passed in by the runner.
- No uncaught exceptions — wrap all I/O in try/catch and return BLOCKED on
  infrastructure errors (network, Docker daemon, etc.).
- CommonJS only (`require` / `module.exports`). No `import`/`export`.
- Return BLOCKED (not FAIL) when an external tool or service is unavailable.
- Return FAIL when the requirement condition is not met and the tool is available.
- Log names of env vars in detail strings; never log values.

### Per-module implementation contracts

For each module implement **every condition** identified in the Step 4
condition-by-condition check. Do not skip any condition, even if the current
repo state would make it pass trivially.

Refer to `runbook-compiler-plan.md` (Sub-Task 3, check modules table) for the
full logic specification of each module. Key references:

- `ci_green.js` — Step 1: `git rev-parse HEAD`; derive owner/repo from
  `git remote get-url origin`; GET GitHub Actions runs API; assert
  `conclusion === 'success'` AND `head_sha === localSHA`. Use `GITHUB_TOKEN`
  if present in env.
- `version_changelog.js` — Step 2: read `package.json` version; assert
  `CHANGELOG.md` contains `## {version}` heading.
- `config_vars.js` — Step 3: assert `DATABASE_URL`, `JWT_SECRET`, `LOG_LEVEL`
  present in env; output names only.
- `migrations_staging.js` — Step 4: if `STAGING_URL` present, use external;
  otherwise create temp SQLite file and run `scripts/migrate.js`
  programmatically. Label accordingly.
- `health_check_staging.js` — Step 5: boot app on random port (or use
  `STAGING_URL`); `GET /health`; assert 200 AND body confirms DB reachable.
  Read `src/routes/health.js` at compile time to confirm the exact body shape.
- `smoke_tests.js` — Step 6: boot app + migrate; run all three flows inline
  (login, create shift, list shifts). Do NOT delegate to `scripts/smoke.js`
  because it does not cover create-shift. Assert all three pass.
- `docker_image_tagged.js` — Step 7: detect `process.platform`; on win32 use
  `docker build -t shiftboard-api:{version} .`; on others run
  `scripts/build-image.sh`. BLOCKED if Docker daemon unreachable. FAIL if
  tag equals `latest`.
- `non_root_container.js` — Step 8: `docker inspect shiftboard-api:{version}`;
  check `Config.User`; FAIL if empty, `root`, or `0`. BLOCKED if Docker
  unreachable.
- `rollback_file.js` — Step 9: all five conditions in order: (1) file exists,
  (2) git-tracked (`git ls-files`), (3) committed/clean (`git status --porcelain`),
  (4) content matches semver-ish regex `v?\d+\.\d+\.\d+.*`, (5) differs from
  `package.json` version.

After writing all modules, read `src/routes/health.js` to confirm the `/health`
response body shape and update `health_check_staging.js` if needed.

Mark Step 6 complete on the todo list.

---

## Step 7 — Write docs/gap-report.md

Write `docs/gap-report.md` using `write_file`.

Use this exact format:

```markdown
# Gap Report -- shiftboard-api Release Runbook

Generated by runbook-compiler on {ISO 8601 date}.
Source: docs/release-runbook.pdf

## Step N -- {short title}

**Requirement:** "{exact PDF text}"

**Gap:** {description of what the repo cannot satisfy today}

**Evidence:**
- `{file}:{line}` -- {observation}

**Suggested remediation:** {what to change, without touching src/, test/, or migrations/ unless the
gap is in application behaviour}
```

Include one section for every gap found by the Gap Analyst in Step 3 (where
`satisfiable: false`). If no gaps were found, write a single sentence:
"No gaps identified."

Do not include gaps that are resolved by the check modules themselves (e.g. a
runtime BLOCKED for Docker unavailability is not a repo gap — it is expected
behaviour).

Mark Step 7 complete on the todo list. The compile run is complete.
