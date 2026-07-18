#!/usr/bin/env bash
# ==============================================================
# Vibot — server-side release (run ON the VPS by the CI over SSH)
# Installs runtime deps, runs Prisma migrations, (re)starts PM2,
# rebuilds the bot Docker image and reloads Nginx.
# ==============================================================
set -euo pipefail

APP_DIR=/var/www/vibot

echo "── [1/5] Server deps + Prisma ──"
cd "$APP_DIR/server"
if [ ! -f .env ]; then
  echo "!! $APP_DIR/server/.env manquant — crée-le à partir de .env.production.example" >&2
  exit 1
fi
npm ci --silent
npx prisma generate
npx prisma migrate deploy

echo "── [2/5] Logs dir ──"
mkdir -p /var/log/vibot

echo "── [3/5] PM2 (server) ──"
cd "$APP_DIR"
pm2 startOrRestart ecosystem.config.js --env production
pm2 save

echo "── [4/5] Bot Docker image ──"
if [ -f "$APP_DIR/bot/Dockerfile" ]; then
  cd "$APP_DIR/bot"
  docker build -t vibot-bot:latest .
fi

echo "── [5/5] Nginx reload ──"
nginx -t && systemctl reload nginx

echo "✅ Release OK"
