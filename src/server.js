const { createApp } = require('./app');

const port = process.env.PORT || 3000;
createApp().listen(port, () => {
  console.log(`shiftboard-api listening on ${port} (log level: ${process.env.LOG_LEVEL || 'info'})`);
});
