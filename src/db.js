const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

function resolveDbPath() {
  const url = process.env.DATABASE_URL || 'file:./data/shiftboard.db';
  return path.resolve(url.replace(/^file:/, ''));
}

let db;
function getDb() {
  if (!db) {
    const file = resolveDbPath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    db = new DatabaseSync(file);
    db.exec('PRAGMA journal_mode = WAL');
  }
  return db;
}

module.exports = { getDb, resolveDbPath };
