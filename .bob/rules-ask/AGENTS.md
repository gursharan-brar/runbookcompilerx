# Project Documentation Context (Non-Obvious Only)

- The test suite uses Node's **built-in** test runner (`node:test`) — not Jest, Mocha, or Vitest. `npm test` is `node --test`.
- There is only one test file: [`test/shifts.test.js`](../../test/shifts.test.js). Coverage is intentionally minimal.
- `scripts/smoke.js` is a separate integration check (not part of `npm test`); it can target a live deployment via `BASE_URL`.
- The demo user (`demo@shiftboard.dev` / `demo-password`) is created by `npm run migrate`, not by tests directly.
- No linter, no formatter, no TypeScript — there are no config files for those tools.
