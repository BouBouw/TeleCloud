require('dotenv').config()
const { Telegraf } = require('telegraf')
const fetch = require('node-fetch')
const fs = require('fs')
const path = require('path')
const https = require('https')
const http = require('http')

const TOKEN       = process.env.TELEGRAM_TOKEN
const CHANNEL_ID  = process.env.CHANNEL_ID
const BOT_ID      = process.env.BOT_ID
const WORKSPACE_ID = process.env.WORKSPACE_ID
const API_URL     = process.env.API_URL ?? 'http://localhost:4000'
const REACTION    = process.env.REACTION ?? null   // e.g. "🔥" — auto-react after each send

if (!TOKEN || !CHANNEL_ID) {
  console.error('[Vibot Bot] TELEGRAM_TOKEN and CHANNEL_ID are required')
  process.exit(1)
}

const bot = new Telegraf(TOKEN)

// ── Helpers ──────────────────────────────────────────────────────────────────
async function getApiTracks() {
  try {
    const res = await fetch(`${API_URL}/api/workspaces/${WORKSPACE_ID}/tracks?limit=50`, {
      headers: { 'x-internal-bot': BOT_ID ?? '' },
    })
    if (!res.ok) return []
    const data = await res.json()
    return data.tracks ?? []
  } catch (err) {
    console.error('[Vibot Bot] Failed to fetch tracks:', err.message)
    return []
  }
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http
    const file = fs.createWriteStream(dest)
    protocol.get(url, res => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        file.close()
        downloadFile(res.headers.location, dest).then(resolve).catch(reject)
        return
      }
      res.pipe(file)
      file.on('finish', () => { file.close(); resolve(dest) })
    }).on('error', err => { fs.unlink(dest, () => {}); reject(err) })
  })
}

// ── Commands ──────────────────────────────────────────────────────────────────
bot.command('start', ctx => {
  ctx.reply(
    `🎵 *Vibot Bot* is online!\n\n` +
    `Connected to workspace: \`${WORKSPACE_ID}\`\n` +
    `Broadcasting to: \`${CHANNEL_ID}\`\n\n` +
    `Commands:\n` +
    `/tracks — List available tracks\n` +
    `/broadcast — Send a random track to the channel\n` +
    `/status — Show bot status`,
    { parse_mode: 'Markdown' },
  )
})

bot.command('status', ctx => {
  ctx.reply(
    `✅ *Bot Status*\n` +
    `• Bot ID: \`${BOT_ID}\`\n` +
    `• Workspace: \`${WORKSPACE_ID}\`\n` +
    `• Channel: \`${CHANNEL_ID}\`\n` +
    `• API: \`${API_URL}\``,
    { parse_mode: 'Markdown' },
  )
})

bot.command('tracks', async ctx => {
  const tracks = await getApiTracks()
  if (!tracks.length) {
    ctx.reply('📭 No tracks found in this workspace.')
    return
  }
  const list = tracks.slice(0, 20).map((t, i) =>
    `${i + 1}. *${escMd(t.title)}* — ${escMd(t.artist ?? 'Unknown')}`,
  ).join('\n')
  ctx.reply(`🎵 *Tracks in library (${tracks.length} total):*\n\n${list}`, { parse_mode: 'Markdown' })
})

bot.command('broadcast', async ctx => {
  const tracks = await getApiTracks()
  const available = tracks.filter(t => t.filePath)

  if (!available.length) {
    ctx.reply('❌ No downloadable tracks found.')
    return
  }

  const track = available[Math.floor(Math.random() * available.length)]
  const streamUrl = `${API_URL}/storage/${track.filePath}`
  const tmpFile   = path.join('/tmp', `${track.id}.mp3`)

  ctx.reply(`📡 Broadcasting: *${escMd(track.title)}*...`, { parse_mode: 'Markdown' })

  try {
    await downloadFile(streamUrl, tmpFile)
    const msg = await bot.telegram.sendAudio(CHANNEL_ID, { source: tmpFile }, {
      title:     track.title,
      performer: track.artist ?? 'Unknown',
      caption:   `🎵 *${escMd(track.title)}*\n🎤 ${escMd(track.artist ?? 'Unknown')}\n\n_Powered by Vibot_`,
      parse_mode: 'Markdown',
    })
    fs.unlink(tmpFile, () => {})

    // Auto-react to the channel post if a reaction emoji is configured
    if (REACTION && msg && msg.message_id) {
      try {
        await bot.telegram.callApi('setMessageReaction', {
          chat_id:   CHANNEL_ID,
          message_id: msg.message_id,
          reaction:  [{ type: 'emoji', emoji: REACTION }],
          is_big:    false,
        })
      } catch (reactErr) {
        console.warn('[Vibot Bot] Reaction failed (non-fatal):', reactErr.message)
      }
    }

    ctx.reply('✅ Broadcast sent!')
  } catch (err) {
    ctx.reply(`❌ Broadcast failed: ${err.message}`)
    console.error('[Vibot Bot] Broadcast error:', err)
  }
})

// ── Error handling ────────────────────────────────────────────────────────────
bot.catch((err, ctx) => {
  console.error(`[Vibot Bot] Error for ${ctx.updateType}:`, err)
})

// ── Launch ────────────────────────────────────────────────────────────────────
bot.launch().then(() => {
  console.log(`[Vibot Bot] Running — workspace: ${WORKSPACE_ID}, channel: ${CHANNEL_ID}`)
})

process.once('SIGINT',  () => bot.stop('SIGINT'))
process.once('SIGTERM', () => bot.stop('SIGTERM'))

// ── Helpers ───────────────────────────────────────────────────────────────────
function escMd(str) {
  return (str ?? '').replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&')
}
