const express = require('express');
const { getDb } = require('../db');

const router = express.Router();

router.get('/', (req, res) => {
  try {
    getDb().prepare('SELECT 1').get();
    res.json({ status: 'ok', db: 'ok' });
  } catch (e) {
    res.status(503).json({ status: 'error', db: 'error' });
  }
});

module.exports = router;
