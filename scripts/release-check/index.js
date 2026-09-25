// scripts/release-check/index.js
// Release gate runner — loads release-gate.yaml and runs all auto checks.
'use strict';

const fs = require('fs');
const path = require('path');

const GATE_YAML = path.resolve(__dirname, '..', '..', 'release-gate.yaml');
const CHECKS_DIR = path.resolve(__dirname, 'checks');

// Minimal YAML parser for the simple schema used in release-gate.yaml.
// Handles only the subset needed: string scalars, boolean scalars, list of maps.
function parseGateYaml(text) {
  const lines = text.split('\n');
  const gates = [];
  let currentGate = null;
  let inGates = false;

  for (const rawLine of lines) {
    const line = rawLine.replace(/\r$/, '');
    if (/^gates:/.test(line)) { inGates = true; continue; }
    if (!inGates) continue;

    // New gate entry
    if (/^  - id:/.test(line)) {
      if (currentGate) gates.push(currentGate);
      currentGate = { id: line.replace(/^  - id:\s*/, '').trim() };
      continue;
    }

    if (!currentGate) continue;

    const kvMatch = line.match(/^    (\w+):\s*(.*)/);
    if (!kvMatch) continue;
    const [, key, value] = kvMatch;

    const trimmed = value.trim();
    // Remove surrounding quotes
    const unquoted = trimmed.replace(/^"(.*)"$/, '$1');

    if (trimmed === 'true') currentGate[key] = true;
    else if (trimmed === 'false') currentGate[key] = false;
    else currentGate[key] = unquoted;
  }
  if (currentGate) gates.push(currentGate);
  return gates;
}

async function main() {
  let gateText;
  try {
    gateText = fs.readFileSync(GATE_YAML, 'utf8');
  } catch (e) {
    console.error(`ERROR: Cannot read release-gate.yaml: ${e.message}`);
    process.exit(2);
  }

  const gates = parseGateYaml(gateText);
  const autoGates = gates.filter(g => g.status === 'auto');
  const manualGates = gates.filter(g => g.status === 'manual');

  console.log(`\nRelease Gate Check — ${autoGates.length} auto, ${manualGates.length} manual\n`);

  let anyFail = false;
  let anyBlocked = false;

  for (const gate of autoGates) {
    const checkFile = path.join(CHECKS_DIR, `${gate.check}.js`);
    let checkFn;
    try {
      checkFn = require(checkFile);
    } catch (e) {
      console.log(`  [BLOCKED] Step ${gate.step} — ${gate.id}: check module not found (${gate.check}.js)`);
      anyBlocked = true;
      continue;
    }

    let result;
    try {
      result = await checkFn(gate.params || {}, process.env);
    } catch (e) {
      result = { status: 'BLOCKED', detail: `Check threw an uncaught exception: ${e.message}` };
    }

    const icon = result.status === 'PASS' ? '✓' : result.status === 'FAIL' ? '✗' : '⊘';
    console.log(`  [${result.status}] ${icon} Step ${gate.step} — ${gate.id}`);
    if (result.status !== 'PASS') {
      console.log(`         ${result.detail}`);
    }

    if (result.status === 'FAIL') anyFail = true;
    if (result.status === 'BLOCKED') anyBlocked = true;
  }

  if (manualGates.length > 0) {
    console.log('\nManual gates (operator action required):');
    for (const gate of manualGates) {
      const marker = gate.post_deploy ? '[POST-DEPLOY]' : '[PRE-DEPLOY]';
      console.log(`  ${marker} Step ${gate.step} — ${gate.id}`);
      console.log(`         ${gate.prompt}`);
    }
  }

  console.log('');
  if (anyFail) {
    console.error('RESULT: FAIL — one or more gates failed. Fix issues before releasing.');
    process.exit(1);
  }
  if (anyBlocked) {
    console.warn('RESULT: BLOCKED — one or more gates could not be checked. Resolve blockers before releasing.');
    process.exit(2);
  }
  console.log('RESULT: PASS — all auto gates passed. Complete manual gates before/after deploy as marked.');
  process.exit(0);
}

main();
