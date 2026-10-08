// PM2 configuration for running the console without Docker, e.g. as a CloudPanel Node.js
// site. Settings come from the .env in the repository root; PORT there must match the app
// port of the site. See docs/deployment.md.
const path = require('node:path');

module.exports = {
  apps: [
    {
      name: 'weblion-console',
      cwd: path.resolve(__dirname, '../../apps/api'),
      script: 'dist/index.js',
      node_args: '--env-file=../../.env',
      env: {
        NODE_ENV: 'production',
        // Only the local reverse proxy (nginx of CloudPanel) talks to the app.
        HOST: '127.0.0.1',
        WEB_DIST_DIR: '../web/dist',
      },
      max_memory_restart: '500M',
      // Give running requests and the jobs time to finish on restart.
      kill_timeout: 10_000,
    },
  ],
};
