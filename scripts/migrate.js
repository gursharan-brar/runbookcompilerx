const fs = require('fs');
const path = require('path');
const { getDb } = require('../src/db');
const { hashPassword } = require('../src/routes/auth');

const db = getDb();
db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');

const dir = path.join(__dirname, '..', 'migrations');
const applied = new Set(db.prepare('SELECT name FROM schema_migrations').all().map(r => r.name));
const pending = fs.readdirSync(dir).filter(f => f.endsWith('.sql') && !applied.has(f)).sort();

for (const file of pending) {
  const sql = fs.readFileSync(path.join(dir, file), 'utf8');
  db.exec('BEGIN');
  try {
    db.exec(sql);
    db.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)').run(file, new Date().toISOString());
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  console.log(`applied ${file}`);
}

// demo account for local and staging use only
const demo = db.prepare('SELECT id FROM users WHERE email = ?').get('demo@shiftboard.dev');
if (!demo) {
  const salt = 'demo-salt';
  db.prepare('INSERT INTO users (email, salt, password_hash) VALUES (?, ?, ?)')
    .run('demo@shiftboard.dev', salt, hashPassword('demo-password', salt));
  console.log('seeded demo user');
}

console.log(pending.length ? `${pending.length} migration(s) applied` : 'no pending migrations');
