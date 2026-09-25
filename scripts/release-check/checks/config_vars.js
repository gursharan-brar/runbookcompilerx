// scripts/release-check/checks/config_vars.js
'use strict';

module.exports = async function run(params, env) {
  try {
    const required = ['DATABASE_URL', 'JWT_SECRET', 'LOG_LEVEL'];
    const missing = [];

    // Conditions 1-3: assert each required variable is present in env
    for (const name of required) {
      if (!env[name]) {
        missing.push(name);
      }
    }

    // Condition 4: log only the var names, never values
    if (missing.length > 0) {
      return {
        status: 'FAIL',
        detail: `Missing required environment variables: ${missing.join(', ')}`,
      };
    }

    return {
      status: 'PASS',
      detail: `All required environment variables are set: ${required.join(', ')}`,
    };
  } catch (e) {
    return { status: 'BLOCKED', detail: `Unexpected error in config_vars check: ${e.message}` };
  }
};
