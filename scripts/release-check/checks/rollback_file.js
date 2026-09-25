// scripts/release-check/checks/rollback_file.js
'use strict';

const fs = require('fs');
const path = require('path');
const { execSync, spawnSync } = require('child_process');

const PREVIOUS_TAG_PATH = path.resolve(__dirname, '..', '..', '..', 'releases', 'PREVIOUS_TAG');
// Semver-ish: optional image-name prefix (e.g. "shiftboard-api:"), optional leading 'v',
// then N.N.N, then optional pre-release/build metadata.
// Matches: "1.3.2", "v1.3.2", "shiftboard-api:1.3.2", "shiftboard-api:v1.3.2"
const SEMVER_RE = /^([^:]+:)?v?\d+\.\d+\.\d+/;

module.exports = async function run(params, env) {
  try {
    // Condition 1: file exists
    if (!fs.existsSync(PREVIOUS_TAG_PATH)) {
      return {
        status: 'FAIL',
        detail: `releases/PREVIOUS_TAG does not exist. Write the currently deployed image tag to that file and commit it before deploying.`,
      };
    }

    const relativeTagPath = 'releases/PREVIOUS_TAG';
    const repoRoot = path.resolve(__dirname, '..', '..', '..');

    // Condition 2: file is git-tracked
    const lsResult = spawnSync('git', ['ls-files', '--error-unmatch', relativeTagPath], {
      encoding: 'utf8',
      timeout: 10_000,
      cwd: repoRoot,
    });
    if (lsResult.error) {
      return { status: 'BLOCKED', detail: `git ls-files failed to run: ${lsResult.error.message}` };
    }
    if (lsResult.status !== 0) {
      return {
        status: 'FAIL',
        detail: `releases/PREVIOUS_TAG is not tracked by git. Add it with "git add releases/PREVIOUS_TAG" and commit.`,
      };
    }

    // Condition 3: file is committed and clean (no uncommitted changes)
    const statusResult = spawnSync('git', ['status', '--porcelain', relativeTagPath], {
      encoding: 'utf8',
      timeout: 10_000,
      cwd: repoRoot,
    });
    if (statusResult.error) {
      return { status: 'BLOCKED', detail: `git status failed to run: ${statusResult.error.message}` };
    }
    const statusOutput = (statusResult.stdout || '').trim();
    if (statusOutput.length > 0) {
      return {
        status: 'FAIL',
        detail: `releases/PREVIOUS_TAG has uncommitted changes (git status: "${statusOutput}"). Commit it before deploying.`,
      };
    }

    // Condition 4: content matches semver-ish regex (with optional image:tag prefix)
    const tagContent = fs.readFileSync(PREVIOUS_TAG_PATH, 'utf8').trim();
    if (!SEMVER_RE.test(tagContent)) {
      return {
        status: 'FAIL',
        detail: `releases/PREVIOUS_TAG content "${tagContent}" does not match a semver-ish tag ` +
          `(e.g. "1.3.2", "v1.3.2", or "shiftboard-api:1.3.2").`,
      };
    }

    // Condition 5: content differs from package.json version (rollback tag ≠ candidate version)
    let pkgVersion;
    try {
      const pkgPath = path.resolve(repoRoot, 'package.json');
      pkgVersion = JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version;
    } catch (e) {
      return { status: 'BLOCKED', detail: `Cannot read package.json: ${e.message}` };
    }

    // Normalise for comparison: strip optional image-name prefix and leading 'v'
    const normTag = tagContent.replace(/^[^:]+:/, '').replace(/^v/, '');
    const normPkg = (pkgVersion || '').replace(/^v/, '');

    if (normTag === normPkg) {
      return {
        status: 'FAIL',
        detail: `releases/PREVIOUS_TAG ("${tagContent}") is the same as the candidate version in package.json ("${pkgVersion}"). ` +
          `The rollback tag must refer to the currently deployed version, not the version being released.`,
      };
    }

    return {
      status: 'PASS',
      detail: `releases/PREVIOUS_TAG is "${tagContent}" (git-tracked, committed, valid tag, differs from candidate ${pkgVersion}).`,
    };
  } catch (e) {
    return { status: 'BLOCKED', detail: `Unexpected error in rollback_file check: ${e.message}` };
  }
};
