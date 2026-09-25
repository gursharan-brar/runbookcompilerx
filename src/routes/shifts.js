const express = require('express');
const { getDb } = require('../db');

const router = express.Router();

router.get('/', (req, res) => {
  const rows = getDb().prepare('SELECT id, worker, starts_at, ends_at, role FROM shifts ORDER BY starts_at').all();
  res.json({ shifts: rows });
});

router.post('/', (req, res) => {
  const { worker, starts_at, ends_at, role } = req.body || {};
  if (!worker || !starts_at || !ends_at) {
    return res.status(400).json({ error: 'worker_starts_at_ends_at_required' });
  }
  if (new Date(ends_at) <= new Date(starts_at)) {
    return res.status(400).json({ error: 'ends_at_must_be_after_starts_at' });
  }
  const info = getDb()
    .prepare('INSERT INTO shifts (worker, starts_at, ends_at, role) VALUES (?, ?, ?, ?)')
    .run(worker, starts_at, ends_at, role || null);
  res.status(201).json({ id: info.lastInsertRowid, worker, starts_at, ends_at, role: role || null });
});

module.exports = router;
