v# ==============================================================
# Vibot -- Deploy Script
# Usage : .\deploy\deploy.ps1
# ==============================================================
$ErrorActionPreference = 'Stop'

$VPS_IP    = "37.187.37.234"
$VPS_USER  = "root"
$APP_DIR   = "/var/www/vibot"
$SSH       = "${VPS_USER}@${VPS_IP}"
$RepoRoot  = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host ""
Write-Host "====================================" -ForegroundColor Cyan
Write-Host "   Vibot -- Deploy                  " -ForegroundColor Cyan
Write-Host "====================================" -ForegroundColor Cyan
Write-Host ""

# -- Verification .env
$envCheck = ssh $SSH "test -f $APP_DIR/server/.env && echo exists || echo missing"
if ($envCheck.Trim() -ne 'exists') {
    Write-Host ".env manquant sur le VPS !" -ForegroundColor Red
    Write-Host "  ssh $SSH"
    Write-Host "  cp $APP_DIR/server/.env.production.example $APP_DIR/server/.env"
    Write-Host "  nano $APP_DIR/server/.env"
    exit 1
}

# -- [1/5] Build frontend
Write-Host "[1/5] Build frontend..." -ForegroundColor Yellow
Set-Location "$RepoRoot\web"
npm ci --silent
npm run build

# -- [2/5] Build backend
Write-Host "[2/5] Build backend..." -ForegroundColor Yellow
Set-Location "$RepoRoot\server"
npm ci --silent
npm run build

# -- [3/5] Upload frontend
Write-Host "[3/5] Upload frontend..." -ForegroundColor Yellow
$webZip = Join-Path $env:TEMP "vibot-web.zip"
if (Test-Path $webZip) { Remove-Item $webZip }
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::CreateFromDirectory("$RepoRoot\web\dist", $webZip)
scp $webZip "${SSH}:/tmp/vibot-web.zip"
ssh $SSH "rm -rf $APP_DIR/web/dist && mkdir -p $APP_DIR/web/dist && unzip -q /tmp/vibot-web.zip -d $APP_DIR/web/dist && rm /tmp/vibot-web.zip"

# -- [4/5] Upload backend + bot
Write-Host "[4/5] Upload backend et bot..." -ForegroundColor Yellow
ssh $SSH "rm -rf $APP_DIR/server/dist && mkdir -p $APP_DIR/server /var/www/vibot/bot"
scp -r "$RepoRoot\server\dist"              "${SSH}:$APP_DIR/server/"
scp    "$RepoRoot\server\package.json"      "${SSH}:$APP_DIR/server/"
scp    "$RepoRoot\server\package-lock.json" "${SSH}:$APP_DIR/server/"
scp -r "$RepoRoot\server\prisma"            "${SSH}:$APP_DIR/server/"
scp    "$ScriptDir\ecosystem.config.js"     "${SSH}:$APP_DIR/"
scp    "$RepoRoot\bot\index.js"             "${SSH}:/var/www/vibot/bot/index.js"
scp    "$RepoRoot\bot\package.json"         "${SSH}:/var/www/vibot/bot/package.json"
scp    "$RepoRoot\bot\Dockerfile"           "${SSH}:/var/www/vibot/bot/Dockerfile"

# -- [5/5] Remote : deps, migrations, PM2, Docker, Nginx
Write-Host "[5/5] Migrations, PM2, Docker, Nginx..." -ForegroundColor Yellow
ssh $SSH "cd $APP_DIR/server && npm ci --silent"
ssh $SSH "cd $APP_DIR/server && npx prisma generate"
ssh $SSH "cd $APP_DIR/server && npx prisma migrate deploy"
ssh $SSH "mkdir -p /var/log/vibot"
ssh $SSH "cd $APP_DIR && (pm2 start ecosystem.config.js --env production 2>/dev/null || pm2 restart ecosystem.config.js) && pm2 save"
ssh $SSH "cd /var/www/vibot/bot && docker build -t vibot-bot:latest ."
ssh $SSH "nginx -t && systemctl reload nginx"

Write-Host ""
Write-Host "Deploye sur https://vibot.cloud" -ForegroundColor Green
Write-Host ""
Write-Host "Commandes utiles :"
Write-Host "  Logs API    : ssh $SSH pm2 logs vibot-server"
Write-Host "  Status PM2  : ssh $SSH pm2 status"
Write-Host "  Containers  : ssh $SSH docker ps"
Write-Host "  Logs Nginx  : ssh $SSH tail -50 /var/log/nginx/error.log"
