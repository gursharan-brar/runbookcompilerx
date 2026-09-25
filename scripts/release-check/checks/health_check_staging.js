// scripts/release-check/checks/health_check_staging.js
//
// NOTE (gap): src/routes/health.js currently returns { status: 'ok' } only.
// It does not report database reachability. This check will FAIL against the
// current implementation because the runbook requires the health response to
// confirm the DB is reachable. See docs/gap-report.md Step 5.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { spawnSync } = require('child_process');

// Find a free TCP port
function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

// Wait until a port accepts connections (up to timeoutMs)
async function waitForPort(port, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 200));
    const ok = await new Promise(resolve => {
      const s = net.createConnection({ port, host: '127.0.0.1' });
      s.on('connect', () => { s.destroy(); resolve(true); });
      s.on('error', () => resolve(false));
    });
    if (ok) return;
  }
  throw new Error(`Port ${port} did not become reachable within ${timeoutMs}ms`);
}

module.exports = async function run(params, env) {
  let tmpDir;
  let serverProcess;

  try {
    const stagingUrl = env.STAGING_URL;
    let base;

    if (stagingUrl) {
      // Condition 1a: use external staging URL
      base = stagingUrl.replace(/\/$/, '');
    } else {
      // Condition 1b: boot app locally on a random port with a temp DB
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-check-health-'));
      const tmpDb = path.join(tmpDir, 'health.db');

      // Run migrate first
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
        return { status: 'BLOCKED', detail: `Migration failed before health check: ${(migrateResult.stderr || '').trim()}` };
      }

      const port = await getFreePort();
      base = `http://127.0.0.1:${port}`;

      const serverScript = path.resolve(__dirname, '..', '..', '..', 'src', 'server.js');
      const { spawn } = require('child_process');
      serverProcess = spawn(
        process.execPath,
        ['--disable-warning=ExperimentalWarning', serverScript],
        {
          env: {
            ...env,
            DATABASE_URL: `file:${tmpDb}`,
            JWT_SECRET: env.JWT_SECRET || 'tmp-secret',
            PORT: String(port),
          },
          stdio: 'ignore',
        }
      );

      try {
        await waitForPort(port, 15_000);
      } catch (e) {
        return { status: 'BLOCKED', detail: `Local app server did not start: ${e.message}` };
      }
    }

    // Condition 2: GET /health
    let res, body;
    try {
      res = await fetch(`${base}/health`);
      body = await res.json();
    } catch (e) {
      return { status: 'BLOCKED', detail: `GET /health request failed: ${e.message}` };
    }

    // Condition 3: assert HTTP 200
    if (res.status !== 200) {
      return {
        status: 'FAIL',
        detail: `GET /health returned HTTP ${res.status}, expected 200`,
      };
    }

    // Condition 4: assert body reports DB reachable
    // The runbook requires the health response to confirm the database is reachable.
    // Current src/routes/health.js only returns { status: 'ok' } — it does NOT include
    // a db field. This condition will FAIL until the health route is updated to check
    // the database and include a db-reachability indicator in the response.
    const dbReachable =
      body &&
      (body.db === 'ok' ||
        body.db === true ||
        body.database === 'ok' ||
        body.database === true ||
        (body.db && body.db.status === 'ok'));

    if (!dbReachable) {
      return {
        status: 'FAIL',
        detail: `GET /health returned 200 but response does not confirm DB is reachable. ` +
          `Got: ${JSON.stringify(body)}. ` +
          `The /health route must include a database reachability check (see gap-report.md Step 5).`,
      };
    }

    return {
      status: 'PASS',
      detail: `GET /health returned 200 and confirmed DB is reachable. Response: ${JSON.stringify(body)}`,
    };
  } catch (e) {
    return { status: 'BLOCKED', detail: `Unexpected error in health_check_staging check: ${e.message}` };
  } finally {
    if (serverProcess) {
      try { serverProcess.kill(); } catch (_) {}
    }
    if (tmpDir) {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
    }
  }
};
