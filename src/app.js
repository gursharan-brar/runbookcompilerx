const express = require('express');
const auth = require('./routes/auth');
const shifts = require('./routes/shifts');
const health = require('./routes/health');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/health', health);
  app.use('/login', auth.router);
  app.use('/shifts', auth.requireAuth, shifts);
  app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ error: 'internal_error' });
  });
  return app;
}

module.exports = { createApp };
