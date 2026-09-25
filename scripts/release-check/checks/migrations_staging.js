// scripts/release-check/checks/migrations_staging.js
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync, spawnSync } = require('child_process');

module.exports = async function run(params, env) {
  try {
    const stagingUrl = env.STAGING_URL;

    if (stagingUrl) {
      // Condition 1a: STAGING_URL is set — run migrate against external staging
      // The migrate script reads DATABASE_URL from env; point it at staging.
      const migrateScript = path.resolve(__dirname, '..', '..', 'migrate.js');
      const result = spawnSync(
        process.execPath,
        ['--disable-warning=ExperimentalWarning', migrateScript],
        {
          env: { ...env, DATABASE_URL: stagingUrl },
          encoding: 'utf8',
          timeout: 60_000,
        }
      );

      if (result.error) {
        return { status: 'BLOCKED', detail: `Failed to spawn migrate script: ${result.error.message}` };
      }

      if (result.status !== 0) {
        const stderr = (result.stderr || '').trim();
        const stdout = (result.stdout || '').trim();
        return {
          status: 'FAIL',
          detail: `Migrations against STAGING_URL failed (exit ${result.status}). stderr: ${stderr || stdout}`,
        };
      }

      return {
        status: 'PASS',
        detail: `Migrations ran cleanly against external staging (STAGING_URL).`,
      };
    }

    // Condition 1b: no STAGING_URL — create temp SQLite file and run migrate programmatically
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-check-migrate-'));
    const tmpDb = path.join(tmpDir, 'staging.db');

    try {
      const migrateScript = path.resolve(__dirname, '..', '..', 'migrate.js');
      const result = spawnSync(
        process.execPath,
        ['--disable-warning=ExperimentalWarning', migrateScript],
        {
          env: { ...env, DATABASE_URL: `file:${tmpDb}`, JWT_SECRET: env.JWT_SECRET || 'tmp-secret' },
          encoding: 'utf8',
          timeout: 60_000,
        }
      );

      if (result.error) {
        return { status: 'BLOCKED', detail: `Failed to spawn migrate script: ${result.error.message}` };
      }

      if (result.status !== 0) {
        const stderr = (result.stderr || '').trim();
        const stdout = (result.stdout || '').trim();
        return {
          status: 'FAIL',
          detail: `Migrations failed on temp local DB (exit ${result.status}). stderr: ${stderr || stdout}`,
        };
      }

      return {
        status: 'PASS',
        detail: `Migrations ran cleanly on temp local SQLite DB (no STAGING_URL set).`,
      };
    } finally {
      // Clean up temp dir
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
    }
  } catch (e) {
    return { status: 'BLOCKED', detail: `Unexpected error in migrations_staging check: ${e.message}` };
  }
};
