// Smoke tests. Runs against BASE_URL if set, otherwise boots the app locally.
const { createApp } = require('../src/app');

async function main() {
  let base = process.env.BASE_URL;
  let server;
  if (!base) {
    server = createApp().listen(0);
    base = `http://127.0.0.1:${server.address().port}`;
  }

  const results = [];
  async function check(name, fn) {
    try { await fn(); results.push([name, true]); console.log(`  PASS  ${name}`); }
    catch (e) { results.push([name, false]); console.log(`  FAIL  ${name}: ${e.message}`); }
  }

  let token;
  console.log(`smoke tests against ${base}`);

  await check('login', async () => {
    const r = await fetch(`${base}/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'demo@shiftboard.dev', password: 'demo-password' })
    });
    if (r.status !== 200) throw new Error(`expected 200, got ${r.status}`);
    token = (await r.json()).token;
  });

  await check('list shifts', async () => {
    const r = await fetch(`${base}/shifts`, { headers: { authorization: `Bearer ${token}` } });
    if (r.status !== 200) throw new Error(`expected 200, got ${r.status}`);
    const body = await r.json();
    if (!Array.isArray(body.shifts)) throw new Error('shifts is not an array');
  });

  if (server) server.close();
  const failed = results.filter(([, ok]) => !ok).length;
  console.log(failed ? `${failed} smoke test(s) failed` : 'all smoke tests passed');
  process.exit(failed ? 1 : 0);
}

main();
