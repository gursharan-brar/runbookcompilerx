const { createApp } = require('./app');

const required = ['DATABASE_URL', 'JWT_SECRET', 'LOG_LEVEL'];
const missing = required.filter(v => !process.env[v]);
if (missing.length > 0) {
  console.error(`Missing required environment variables: ${missing.join(', ')}`);
  process.exit(1);
}

const port = process.env.PORT || 3000;
createApp().listen(port, () => {
  console.log(`shiftboard-api listening on ${port} (log level: ${process.env.LOG_LEVEL || 'info'})`);
});
