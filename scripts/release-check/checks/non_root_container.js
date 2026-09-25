// scripts/release-check/checks/non_root_container.js
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

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

    const imageName = `shiftboard-api:${version}`;

    // Condition 4: BLOCKED if Docker unreachable
    const dockerCheck = spawnSync('docker', ['info'], { encoding: 'utf8', timeout: 10_000 });
    if (dockerCheck.error || dockerCheck.status !== 0) {
      return { status: 'BLOCKED', detail: 'Docker daemon is unreachable. Ensure Docker is running.' };
    }

    // Condition 1: docker inspect the image
    const inspectResult = spawnSync('docker', ['inspect', imageName], {
      encoding: 'utf8',
      timeout: 30_000,
    });

    if (inspectResult.error) {
      return { status: 'BLOCKED', detail: `docker inspect failed to run: ${inspectResult.error.message}` };
    }

    if (inspectResult.status !== 0) {
      const stderr = (inspectResult.stderr || '').trim();
      return {
        status: 'FAIL',
        detail: `docker inspect ${imageName} failed (exit ${inspectResult.status}): ${stderr}. ` +
          `Has the image been built? Run the docker_image_tagged gate first.`,
      };
    }

    let inspectData;
    try {
      inspectData = JSON.parse(inspectResult.stdout);
    } catch (e) {
      return { status: 'BLOCKED', detail: `Could not parse docker inspect output: ${e.message}` };
    }

    if (!Array.isArray(inspectData) || inspectData.length === 0) {
      return { status: 'BLOCKED', detail: `docker inspect returned no data for ${imageName}` };
    }

    // Condition 2: read Config.User
    const configUser = (inspectData[0].Config || {}).User || '';

    // Condition 3: FAIL if empty, 'root', or '0'
    if (configUser === '' || configUser === 'root' || configUser === '0') {
      return {
        status: 'FAIL',
        detail: `Container ${imageName} runs as user "${configUser || '(empty)'}". ` +
          `The container must not run as root. Set a non-root USER in the Dockerfile.`,
      };
    }

    return {
      status: 'PASS',
      detail: `Container ${imageName} runs as user "${configUser}" (not root).`,
    };
  } catch (e) {
    return { status: 'BLOCKED', detail: `Unexpected error in non_root_container check: ${e.message}` };
  }
};
