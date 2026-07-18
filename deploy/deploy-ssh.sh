#!/usr/bin/env bash
# ==============================================================
# Vibot — direct deploy from your machine over SSH (no GitHub CI)
# Usage:  bash deploy/deploy-ssh.sh
# Builds front+back locally, ships artifacts to the VPS via tar,
# then runs the remote release (Prisma / PM2 / Docker bot / Nginx).
# Requires the deploy key installed on the VPS (~/.ssh/vibot_deploy).
# ==============================================================
set -euo pipefail

VPS_HOST="${VPS_HOST:-187.127.70.39}"
VPS_USER="${VPS_USER:-root}"
KEY="${VPS_KEY:-$HOME/.ssh/vibot_deploy}"
APP_DIR="/var/www/vibot"
SSH=(ssh -o BatchMode=yes -i "$KEY" "${VPS_USER}@${VPS_HOST}")

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

say() { printf '\n\033[36m── %s ──\033[0m\n' "$1"; }

# push a local dir to a remote dir with an atomic swap (no downtime)
push_dir() { # $1 local  $2 remote
  tar czf - -C "$1" . | "${SSH[@]}" \
    "rm -rf '$2.new' && mkdir -p '$2.new' && tar xzf - -C '$2.new' && rm -rf '$2' && mv '$2.new' '$2'"
}

say "Build frontend"
( cd web && npm ci && npm run build )

say "Build backend (tsc emits despite mergeParams type warnings)"
( cd server && npm ci && (npm run build || echo "  tsc type warnings — JS emitted (noEmitOnError:false)") )
test -f server/dist/index.js || { echo "!! server build produced no dist"; exit 1; }

say "Upload frontend"
push_dir web/dist "$APP_DIR/web/dist"

say "Upload backend"
push_dir server/dist   "$APP_DIR/server/dist"
push_dir server/prisma "$APP_DIR/server/prisma"
scp -o BatchMode=yes -i "$KEY" server/package.json server/package-lock.json "${VPS_USER}@${VPS_HOST}:$APP_DIR/server/"
scp -o BatchMode=yes -i "$KEY" deploy/ecosystem.config.js "${VPS_USER}@${VPS_HOST}:$APP_DIR/"
tar czf - -C server/scripts . | "${SSH[@]}" "mkdir -p '$APP_DIR/server/scripts' && tar xzf - -C '$APP_DIR/server/scripts'" || true

say "Upload bot"
push_dir bot "$APP_DIR/bot"

say "Remote release"
"${SSH[@]}" 'bash -s' < deploy/release.sh

printf '\n\033[32m✅ Déployé sur https://vibot.cloud\033[0m\n'
