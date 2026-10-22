// pm2 alternative to systemd: `pm2 start deploy/ecosystem.config.cjs && pm2 save`.
module.exports = {
  apps: [
    {
      name: 'lazyapp-demo',
      cwd: __dirname + '/..',
      script: 'npm',
      args: 'start',
      instances: 1, // one process: SQLite + the in-process queue keep per-user ordering
      autorestart: true,
      kill_timeout: 20000,
      env: { NODE_ENV: 'production' },
    },
  ],
};
