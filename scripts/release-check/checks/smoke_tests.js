// scripts/release-check/checks/smoke_tests.js
//
// Runs the repo's own smoke suite (npm run smoke) and verifies from its stdout
// that login, create shift, and list shifts each ran and passed.
// Does NOT call the API directly.
//
// NOTE (gap): scripts/smoke.js currently covers only two of the three required
// flows (login, list shifts). The "create shift" flow is absent. This check will
// FAIL on "create shift" until scripts/smoke.js is updated. See gap-report.md Step 6.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

// The three flow names as printed by smoke.js: "  PASS  <name>" / "  FAIL  <name>: ..."
// These must match the check() names used in scripts/smoke.js.
const REQUIRED_FLOWS = ['login', 'create shift', 'list shifts'];

module.exports = async function run(params, env) {
  let tmpDir;

  try {
    const stagingUrl = env.STAGING_URL;
    let runEnv;

    if (stagingUrl) {
      // Use external staging — pass BASE_URL so smoke.js skips local boot
      runEnv = { ...env, BASE_URL: stagingUrl };
    } else {
      // No staging URL — smoke.js will boot the app itself using DATABASE_URL.
      // Provide a temp DB so the migrate+seed inside the app's boot path has a clean slate.
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-check-smoke-'));
      const tmpDb = path.join(tmpDir, 'smoke.db');

      // Run migrate first so demo user exists
      const migrateScript = path.resolve(__dirname, '..', '..', 'migrate.js');
      const migrateResult = spawnSync(
        process.execPath,
        ['--disable-warning=ExperimentalWarning', migrateScript],
        {
          env: { ...env, DATABASE_URL: `file:${tmpDb}`, JWT_SECRET: env.JWT_SECRET || 'tmp-secret' },
          encoding: 'utf8',
          timeout: 30_000,
        }
      );
      if (migrateResult.status !== 0) {
        return {
          status: 'BLOCKED',
          detail: `Migration failed before smoke run: ${(migrateResult.stderr || '').trim()}`,
        };
      }

      runEnv = {
        ...env,
        DATABASE_URL: `file:${tmpDb}`,
        JWT_SECRET: env.JWT_SECRET || 'tmp-secret',
        // No BASE_URL: smoke.js will call createApp().listen(0) itself
      };
    }

    // Run npm run smoke — capture combined stdout+stderr
    const repoRoot = path.resolve(__dirname, '..', '..', '..');
    const result = spawnSync('npm', ['run', 'smoke'], {
      env: runEnv,
      encoding: 'utf8',
      timeout: 60_000,
      cwd: repoRoot,
      shell: process.platform === 'win32',
    });

    if (result.error) {
      return { status: 'BLOCKED', detail: `Failed to spawn npm run smoke: ${result.error.message}` };
    }

    const output = (result.stdout || '') + (result.stderr || '');

    // Parse output lines for PASS/FAIL markers emitted by smoke.js:
    //   "  PASS  <name>"
    //   "  FAIL  <name>: <message>"
    const passed = new Set();
    const failed = new Map(); // name -> message

    for (const line of output.split('\n')) {
      const passMatch = line.match(/^\s+PASS\s+(.+)$/);
      if (passMatch) {
        passed.add(passMatch[1].trim());
        continue;
      }
      const failMatch = line.match(/^\s+FAIL\s+([^:]+):\s*(.*)$/);
      if (failMatch) {
        failed.set(failMatch[1].trim(), failMatch[2].trim());
      }
    }

    const checkFailures = [];

    for (const flow of REQUIRED_FLOWS) {
      if (passed.has(flow)) {
        // Flow ran and passed — good
        continue;
      }
      if (failed.has(flow)) {
        checkFailures.push(`"${flow}" FAILED: ${failed.get(flow)}`);
      } else {
        // Flow did not appear in output at all — smoke.js doesn't implement it
        checkFailures.push(`"${flow}" did not run (not present in smoke suite output)`);
      }
    }

    if (checkFailures.length > 0) {
      return {
        status: 'FAIL',
        detail: `Smoke suite failures: ${checkFailures.join('; ')}`,
      };
    }

    return {
      status: 'PASS',
      detail: `All three required flows passed in smoke suite output: ${REQUIRED_FLOWS.map(f => `"${f}"`).join(', ')}`,
    };
  } catch (e) {
    return { status: 'BLOCKED', detail: `Unexpected error in smoke_tests check: ${e.message}` };
  } finally {
    if (tmpDir) {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
    }
  }
};
