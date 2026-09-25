const { test, before } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const os = require('os');
const fs = require('fs');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'shiftboard-'));
process.env.DATABASE_URL = `file:${path.join(tmp, 'test.db')}`;
process.env.JWT_SECRET = 'test-secret';

const { createApp } = require('../src/app');
let base, token;

before(async () => {
  require('../scripts/migrate.js');
  const server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  server.unref();
  const r = await fetch(`${base}/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'demo@shiftboard.dev', password: 'demo-password' })
  });
  token = (await r.json()).token;
});

test('rejects bad password', async () => {
  const r = await fetch(`${base}/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'demo@shiftboard.dev', password: 'nope' })
  });
  assert.strictEqual(r.status, 401);
});

test('creates and lists a shift', async () => {
  const c = await fetch(`${base}/shifts`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ worker: 'Sam', starts_at: '2026-10-01T09:00:00Z', ends_at: '2026-10-01T17:00:00Z', role: 'dispatch' })
  });
  assert.strictEqual(c.status, 201);
  const l = await fetch(`${base}/shifts`, { headers: { authorization: `Bearer ${token}` } });
  const body = await l.json();
  assert.ok(body.shifts.some(s => s.worker === 'Sam'));
});

test('rejects a shift that ends before it starts', async () => {
  const c = await fetch(`${base}/shifts`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ worker: 'Sam', starts_at: '2026-10-01T17:00:00Z', ends_at: '2026-10-01T09:00:00Z' })
  });
  assert.strictEqual(c.status, 400);
});
