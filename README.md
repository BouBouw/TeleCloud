# SoundSync — Music Broadcasting SaaS Platform

A full-stack SaaS platform for managing and broadcasting music to Telegram channels via Docker-isolated bots.

## Architecture

```
TeleCloud/
├── web/          # Vite + React 19 + TypeScript — Dark Cyberpunk UI
├── server/       # Node.js + Express + TypeScript — REST API
├── bot/          # Telegraf bot template (one container per bot)
└── docker-compose.yml
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Vite 8, React 19, TypeScript, Tailwind CSS v4 |
| Backend | Express 4, TypeScript, Prisma 5 (SQLite), JWT |
| Bots | Telegraf, Node.js 20 Alpine Docker containers |
| Audio | Web Audio API — Studio EQ, frequency visualizer |
| DevOps | Docker Compose, dockerode |

## Quick Start (Development)

### 1. Backend

```bash
cd server
cp .env.example .env
# Edit .env — set JWT_SECRET to a strong random value
npm install
npm run db:migrate
npm run dev
# API runs at http://localhost:4000
```

### 2. Frontend

```bash
cd web
npm install
npm run dev
# UI runs at http://localhost:5173
```

### 3. Bot Docker Image (optional — needed for bot spawning)

```bash
cd bot
docker build -t soundsync-bot:latest .
```

## Production (Docker Compose)

```bash
# Build and start all services
docker compose up --build -d

# View logs
docker compose logs -f server

# Stop
docker compose down
```

The web UI will be available at `http://localhost:3000`, the API at `http://localhost:4000`.

## Features

### Frontend Pages
- **Login** — JWT auth with register/login toggle + demo account
- **Dashboard** — Stats overview (tracks, bots, channels, storage)
- **Library** — Track management + SoundCloud scrape/search
- **Studio** — DAW-like editor with Web Audio API (EQ, waveform, effects)
- **Channels** — Telegram bot fleet management (deploy/start/stop/pause/restart)
- **Admin** — User management, role assignment, system stats

### Backend API

| Endpoint | Description |
|----------|-------------|
| `POST /api/auth/register` | Create account |
| `POST /api/auth/login` | Login + JWT |
| `GET /api/workspaces` | List user workspaces |
| `GET /api/workspaces/:id/tracks` | List tracks |
| `POST /api/workspaces/:id/tracks/scrape` | Scrape from SoundCloud URL |
| `GET /api/workspaces/:id/tracks/search?q=` | Search SoundCloud |
| `GET /api/workspaces/:id/tracks/:id/stream` | Stream audio (Range headers) |
| `GET /api/workspaces/:id/bots` | List bots + live Docker status |
| `POST /api/workspaces/:id/bots` | Deploy new bot container |
| `POST /api/workspaces/:id/bots/:id/action` | start/stop/pause/resume/restart |
| `GET /api/admin/users` | (ADMIN) List all users |

### Bot Commands
- `/start` — Welcome + status info
- `/status` — Show bot configuration
- `/tracks` — List workspace tracks
- `/broadcast` — Send random track as audio to the channel

## Environment Variables

### Server (`server/.env`)

```
PORT=4000
DATABASE_URL=file:./prisma/dev.db
JWT_SECRET=<32+ char random string>
JWT_EXPIRES_IN=7d
STORAGE_PATH=./storage
BOT_IMAGE_NAME=soundsync-bot:latest
CORS_ORIGIN=http://localhost:5173
```

### Bot Container (injected by server via Docker API)

```
TELEGRAM_TOKEN=   # From @BotFather
CHANNEL_ID=       # Telegram channel ID (e.g. -1001234567890)
BOT_ID=           # SoundSync bot UUID
WORKSPACE_ID=     # SoundSync workspace UUID
API_URL=          # Backend URL accessible from Docker
```

## Windows Docker Note

On Windows with Docker Desktop, the dockerode service uses TCP:
```
{ host: '127.0.0.1', port: 2375 }
```
Ensure Docker Desktop has **"Expose daemon on tcp://localhost:2375 without TLS"** enabled in Settings → General.
