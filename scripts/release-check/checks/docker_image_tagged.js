// scripts/release-check/checks/docker_image_tagged.js
'use strict';

const fs = require('fs');
const path = require('path');
const { execSync, spawnSync } = require('child_process');

module.exports = async function run(params, env) {
  try {
    // Read version from package.json
    const pkgPath = path.resolve(__dirname, '..', '..', '..', 'package.json');
    let version;
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      version = pkg.version;
    } catch (e) {
      return { status: 'BLOCKED', detail: `Cannot read package.json: ${e.message}` };
    }

    if (!version) {
      return { status: 'FAIL', detail: 'package.json does not contain a version field' };
    }

    // Condition 4: assert tag is not 'latest'
    if (version === 'latest') {
      return { status: 'FAIL', detail: `package.json version is "latest" — never ship an image tagged latest` };
    }

    // Condition 3/2: check Docker daemon is reachable
    const dockerCheck = spawnSync('docker', ['info'], { encoding: 'utf8', timeout: 10_000 });
    if (dockerCheck.error || dockerCheck.status !== 0) {
      return { status: 'BLOCKED', detail: 'Docker daemon is unreachable. Ensure Docker is running.' };
    }

    // Condition 1: detect platform
    // Condition 2 (win32): docker build directly
    // Condition 3 (others): run scripts/build-image.sh
    let buildResult;
    if (process.platform === 'win32') {
      buildResult = spawnSync(
        'docker',
        ['build', '-t', `shiftboard-api:${version}`, '.'],
        {
          encoding: 'utf8',
          timeout: 300_000,
          cwd: path.resolve(__dirname, '..', '..', '..'),
        }
      );
    } else {
      const buildScript = path.resolve(__dirname, '..', '..', 'build-image.sh');
      buildResult = spawnSync('sh', [buildScript], {
        encoding: 'utf8',
        timeout: 300_000,
        cwd: path.resolve(__dirname, '..', '..', '..'),
      });
    }

    if (buildResult.error) {
      return { status: 'BLOCKED', detail: `Docker build command failed to start: ${buildResult.error.message}` };
    }

    if (buildResult.status !== 0) {
      const stderr = (buildResult.stderr || '').trim().slice(-500);
      return {
        status: 'FAIL',
        detail: `Docker build failed (exit ${buildResult.status}). Last output: ${stderr}`,
      };
    }

    return {
      status: 'PASS',
      detail: `Docker image built and tagged as shiftboard-api:${version} (not latest)`,
    };
  } catch (e) {
    return { status: 'BLOCKED', detail: `Unexpected error in docker_image_tagged check: ${e.message}` };
  }
};
