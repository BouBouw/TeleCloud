# vibot-tunnel

Local CLI bridge that lets YouTube downloads bypass VPS IP restrictions.

## How it works

```
You (local machine)               VPS (vibot.cloud)
───────────────────               ─────────────────
1. vibot-tunnel starts            
2. Sends heartbeat every 10s  →  marks tunnel as active
3. Polls /api/tunnel/jobs/next    
4. yt-dlp downloads video     ←  downloads from YouTube
   with your browser cookies       with your real session
5. Uploads file to VPS        →  stores + creates DB record
6. Deletes local temp file
```

When the tunnel is active, any YouTube import from the web app is automatically routed through the tunnel instead of being attempted from the VPS.

## Setup

1. **Install yt-dlp** on your machine:
   - Windows: `winget install yt-dlp.yt-dlp` or download from https://github.com/yt-dlp/yt-dlp/releases
   - macOS: `brew install yt-dlp`
   - Linux: `sudo pip install yt-dlp`

2. **Create `.env`** from the example:
   ```
   cp .env.example .env
   ```
   Edit `.env` — set `TUNNEL_SECRET` to the same value as `TUNNEL_SECRET` on the VPS.

3. **Add `TUNNEL_SECRET` to the VPS** `/var/www/vibot/server/.env`:
   ```
   TUNNEL_SECRET=your_random_secret_here
   ```
   Then restart: `pm2 restart vibot-server`

4. **Install dependencies & build**:
   ```
   npm install
   npm run build
   ```

5. **Start the tunnel**:
   ```
   npm start
   ```
   Or for development:
   ```
   npm run dev
   ```

## Configuration (.env)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `VPS_URL` | ✅ | — | VPS URL, e.g. `https://vibot.cloud` |
| `TUNNEL_SECRET` | ✅ | — | Shared secret (must match server) |
| `PREFERRED_BROWSER` | ❌ | auto-detect | Browser for cookies: `chrome`, `edge`, `firefox`, `brave`… |
| `TEMP_DIR` | ❌ | OS temp | Directory for temporary downloads |

## Requirements

- **Node.js 18+**
- **yt-dlp** installed and on PATH
- Must be **logged in to YouTube** in your chosen browser
