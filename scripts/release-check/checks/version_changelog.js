// scripts/release-check/checks/version_changelog.js
'use strict';

const fs = require('fs');
const path = require('path');

module.exports = async function run(params, env) {
  try {
    // Condition 1: read package.json version
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

    // Condition 2: assert CHANGELOG.md contains a heading ## {version}
    const changelogPath = path.resolve(__dirname, '..', '..', '..', 'CHANGELOG.md');
    let changelog;
    try {
      changelog = fs.readFileSync(changelogPath, 'utf8');
    } catch (e) {
      return { status: 'FAIL', detail: `CHANGELOG.md not found or unreadable: ${e.message}` };
    }

    // Match a line that is exactly "## {version}" (with optional trailing whitespace)
    const headingRegex = new RegExp(`^##\\s+${version.replace('.', '\\.').replace('.', '\\.')}\\s*$`, 'm');
    if (!headingRegex.test(changelog)) {
      return {
        status: 'FAIL',
        detail: `CHANGELOG.md does not contain a "## ${version}" heading. Add a changelog entry for version ${version}.`,
      };
    }

    return {
      status: 'PASS',
      detail: `package.json version is ${version} and CHANGELOG.md contains ## ${version}`,
    };
  } catch (e) {
    return { status: 'BLOCKED', detail: `Unexpected error in version_changelog check: ${e.message}` };
  }
};
