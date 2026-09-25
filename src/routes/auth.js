const express = require('express');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { getDb } = require('../db');

const router = express.Router();

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 32).toString('hex');
}

router.post('/', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'email_and_password_required' });

  const user = getDb().prepare('SELECT id, email, salt, password_hash FROM users WHERE email = ?').get(email);
  if (!user || hashPassword(password, user.salt) !== user.password_hash) {
    return res.status(401).json({ error: 'invalid_credentials' });
  }

  try {
    const token = jwt.sign({ sub: user.id, email: user.email }, process.env.JWT_SECRET, { expiresIn: '1h' });
    res.json({ token });
  } catch (e) {
    res.status(401).json({ error: 'invalid_credentials' });
  }
});

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'missing_token' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch (e) {
    res.status(401).json({ error: 'invalid_token' });
  }
}

module.exports = { router, requireAuth, hashPassword };
