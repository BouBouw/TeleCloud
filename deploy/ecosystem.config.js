// PM2 ecosystem — Vibot server
module.exports = {
  apps: [
    {
      name: 'vibot-server',
      script: 'dist/index.js',
      cwd: '/var/www/vibot/server',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      env_production: {
        NODE_ENV: 'production',
      },
      error_file: '/var/log/vibot/err.log',
      out_file:   '/var/log/vibot/out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
  ],
}
