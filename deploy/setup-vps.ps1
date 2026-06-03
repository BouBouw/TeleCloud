# ==============================================================
# Vibot -- VPS Initial Setup  (une seule fois)
# Usage : .\deploy\setup-vps.ps1
# ==============================================================
$ErrorActionPreference = 'Stop'

$VPS_IP    = "37.187.37.234"
$VPS_USER  = "root"
$DOMAIN    = "vibot.cloud"
$APP_DIR   = "/var/www/vibot"
$SSH       = "${VPS_USER}@${VPS_IP}"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot  = Split-Path -Parent $ScriptDir

Write-Host ""
Write-Host "====================================" -ForegroundColor Cyan
Write-Host "   Vibot -- VPS Initial Setup       " -ForegroundColor Cyan
Write-Host "====================================" -ForegroundColor Cyan
Write-Host "  VPS    : $VPS_IP"
Write-Host "  Domaine: $DOMAIN"
Write-Host ""

$secPw  = Read-Host "Mot de passe PostgreSQL (utilisateur vibot)" -AsSecureString
$secPw2 = Read-Host "Confirmer le mot de passe"                   -AsSecureString
$pw  = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secPw))
$pw2 = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secPw2))
if ($pw -ne $pw2) { Write-Host "Mots de passe differents." -ForegroundColor Red; exit 1 }
$pwSafe = $pw -replace "'", "''"

Write-Host ""

# -- [1/6] Upload Nginx conf
Write-Host "[1/6] Upload Nginx conf..." -ForegroundColor Yellow
scp "$ScriptDir\nginx.conf" "${SSH}:/tmp/vibot_nginx.conf"

# -- [2/6] Paquets systeme
Write-Host "[2/6] Installation des paquets..." -ForegroundColor Yellow
ssh $SSH "export DEBIAN_FRONTEND=noninteractive && apt-get update -qq && apt-get install -y nodejs postgresql postgresql-contrib nginx certbot python3-certbot-nginx unzip git ufw curl gnupg lsb-release ca-certificates"

# -- Docker CE
Write-Host "       Docker CE..." -ForegroundColor Yellow
ssh $SSH "install -m 0755 -d /etc/apt/keyrings"
ssh $SSH "curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg && chmod a+r /etc/apt/keyrings/docker.gpg"
ssh $SSH "echo ""deb [arch=amd64 signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian bookworm stable"" > /etc/apt/sources.list.d/docker.list"
ssh $SSH "apt-get update -qq && apt-get install -y docker-ce docker-ce-cli containerd.io"
ssh $SSH "systemctl enable docker && systemctl start docker"

# -- PM2
Write-Host "       PM2..." -ForegroundColor Yellow
ssh $SSH "npm install -g pm2"
ssh $SSH "pm2 startup systemd -u root --hp /root 2>&1 | grep -E 'sudo env PATH|^env PATH' | bash || true"

# -- [3/6] PostgreSQL
Write-Host "[3/6] Configuration PostgreSQL..." -ForegroundColor Yellow
ssh $SSH "sudo -u postgres psql -tc ""SELECT 1 FROM pg_roles WHERE rolname='vibot'"" | grep -q 1 || sudo -u postgres psql -c ""CREATE USER vibot WITH PASSWORD '$pwSafe'"""
ssh $SSH "sudo -u postgres psql -tc ""SELECT 1 FROM pg_database WHERE datname='vibot'"" | grep -q 1 || sudo -u postgres psql -c ""CREATE DATABASE vibot OWNER vibot"""

# -- [4/6] Nginx + SSL
Write-Host "[4/6] Nginx + SSL..." -ForegroundColor Yellow
ssh $SSH "mkdir -p $APP_DIR/web/dist $APP_DIR/server/storage /var/log/vibot"
ssh $SSH "mv /tmp/vibot_nginx.conf /etc/nginx/sites-available/vibot && ln -sf /etc/nginx/sites-available/vibot /etc/nginx/sites-enabled/vibot && rm -f /etc/nginx/sites-enabled/default"
ssh $SSH "nginx -t && systemctl reload nginx"
ssh $SSH "certbot --nginx -d $DOMAIN -d www.$DOMAIN --non-interactive --agree-tos --email admin@$DOMAIN --redirect"

# -- [5/6] UFW
Write-Host "[5/6] Pare-feu UFW..." -ForegroundColor Yellow
ssh $SSH "ufw allow OpenSSH"
ssh $SSH "ufw allow 'Nginx Full'"
ssh $SSH "echo y | ufw enable"

# -- [6/6] Build image Docker du bot
Write-Host "[6/6] Build image Docker du bot..." -ForegroundColor Yellow
ssh $SSH "mkdir -p /var/www/vibot/bot"
scp "$RepoRoot\bot\index.js"     "${SSH}:/var/www/vibot/bot/index.js"
scp "$RepoRoot\bot\package.json" "${SSH}:/var/www/vibot/bot/package.json"
scp "$RepoRoot\bot\Dockerfile"   "${SSH}:/var/www/vibot/bot/Dockerfile"
ssh $SSH "cd /var/www/vibot/bot && docker build -t vibot-bot:latest ."

Write-Host ""
Write-Host "Setup VPS termine !" -ForegroundColor Green
Write-Host ""
Write-Host "Etapes suivantes :" -ForegroundColor Yellow
Write-Host "  1. Cree le .env sur le VPS :"
Write-Host "       ssh $SSH"
Write-Host "       cp /var/www/vibot/server/.env.production.example /var/www/vibot/server/.env"
Write-Host "       nano /var/www/vibot/server/.env"
Write-Host ""
Write-Host "  2. Lance le deploiement :"
Write-Host '       .\deploy\deploy.ps1'
