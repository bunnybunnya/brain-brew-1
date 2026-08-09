const app = require('./app');
const env = require('./config/env');

app.listen(env.port, () => {
  // eslint-disable-next-line no-console
  console.log(`${env.appName} backend running on port ${env.port} [${env.nodeEnv}]`);
});
