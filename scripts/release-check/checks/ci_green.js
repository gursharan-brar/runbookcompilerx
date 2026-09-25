// scripts/release-check/checks/ci_green.js
'use strict';

const { execSync } = require('child_process');

module.exports = async function run(params, env) {
  try {
    // Condition 1: get local HEAD SHA
    let localSHA;
    try {
      localSHA = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
    } catch (e) {
      return { status: 'BLOCKED', detail: `Could not read local HEAD SHA: ${e.message}` };
    }

    // Condition 2: derive owner/repo from git remote URL
    let remoteUrl;
    try {
      remoteUrl = execSync('git remote get-url origin', { encoding: 'utf8' }).trim();
    } catch (e) {
      return { status: 'BLOCKED', detail: `Could not read git remote origin: ${e.message}` };
    }

    // Support https://github.com/owner/repo.git and git@github.com:owner/repo.git
    let owner, repo;
    const httpsMatch = remoteUrl.match(/github\.com[/:]([^/]+)\/([^/.]+)(\.git)?$/);
    if (httpsMatch) {
      owner = httpsMatch[1];
      repo = httpsMatch[2];
    } else {
      return { status: 'BLOCKED', detail: `Cannot parse GitHub owner/repo from remote URL: ${remoteUrl}` };
    }

    // Condition 3: call GitHub Actions runs API
    const token = env.GITHUB_TOKEN;
    const headers = {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'release-check',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };

    let runsData;
    try {
      const url = `https://api.github.com/repos/${owner}/${repo}/actions/runs?branch=main&per_page=10`;
      const res = await fetch(url, { headers });
      if (res.status === 401 || res.status === 403) {
        return { status: 'BLOCKED', detail: `GitHub API auth failed (${res.status}). Set GITHUB_TOKEN env var.` };
      }
      if (res.status === 404) {
        return { status: 'BLOCKED', detail: `GitHub repo not found: ${owner}/${repo}` };
      }
      if (!res.ok) {
        return { status: 'BLOCKED', detail: `GitHub API returned ${res.status} for ${owner}/${repo}` };
      }
      runsData = await res.json();
    } catch (e) {
      return { status: 'BLOCKED', detail: `GitHub API request failed: ${e.message}` };
    }

    if (!runsData.workflow_runs || runsData.workflow_runs.length === 0) {
      return { status: 'BLOCKED', detail: `No workflow runs found on main for ${owner}/${repo}` };
    }

    // Find the latest completed run whose head_sha matches localSHA
    const matchingRun = runsData.workflow_runs.find(r => r.head_sha === localSHA);

    // Condition 4 & 5: assert conclusion === 'success' AND head_sha === localSHA
    if (!matchingRun) {
      const latestSHA = runsData.workflow_runs[0].head_sha;
      return {
        status: 'FAIL',
        detail: `No completed workflow run found for local HEAD ${localSHA}. Latest run SHA: ${latestSHA}`,
      };
    }

    if (matchingRun.status !== 'completed') {
      return {
        status: 'FAIL',
        detail: `Workflow run for HEAD ${localSHA} is not completed (status: ${matchingRun.status})`,
      };
    }

    if (matchingRun.conclusion !== 'success') {
      return {
        status: 'FAIL',
        detail: `Workflow run for HEAD ${localSHA} conclusion is '${matchingRun.conclusion}', expected 'success'`,
      };
    }

    return {
      status: 'PASS',
      detail: `CI run ${matchingRun.id} succeeded for HEAD ${localSHA} on ${owner}/${repo}`,
    };
  } catch (e) {
    return { status: 'BLOCKED', detail: `Unexpected error in ci_green check: ${e.message}` };
  }
};
