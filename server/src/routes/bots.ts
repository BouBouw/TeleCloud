import { Router } from 'express'
import { z } from 'zod'
import { v4 as uuid } from 'uuid'
import prisma from '../lib/prisma'
import { authenticate } from '../middleware/auth'
import { validate } from '../middleware/validate'
import {
  spawnBotContainer,
  removeBotContainer,
  pauseBotContainer,
  resumeBotContainer,
  restartBotContainer,
  getContainerStatus,
  getBotLogs,
} from '../services/docker'
import logger from '../lib/logger'

interface WsParams { wsId: string; [key: string]: string }
interface BotParams extends WsParams { botId: string }

const router = Router({ mergeParams: true })
router.use(authenticate)

async function assertManagerOrAbove(workspaceId: string, userId: string) {
  return prisma.workspaceMember.findFirst({
    where: { workspaceId, userId, role: { in: ['OWNER', 'MANAGER'] } },
  })
}

const createSchema = z.object({
  name: z.string().min(1).max(64),
  telegramToken: z.string().min(20),
  channelId: z.string().min(5),
})

/* ── GET /api/workspaces/:wsId/bots ── */
router.get<WsParams>('/', async (req, res) => {
  const member = await prisma.workspaceMember.findFirst({
    where: { workspaceId: req.params.wsId, userId: req.user!.userId },
  })
  if (!member) { res.status(403).json({ error: 'Not a member' }); return }

  try {
    const bots = await prisma.bot.findMany({
      where: { workspaceId: req.params.wsId },
      orderBy: { createdAt: 'desc' },
    })

    // Sync live container statuses in parallel
    const botsWithStatus = await Promise.all(
      bots.map(async bot => {
        if (bot.containerId) {
          const liveStatus = await getContainerStatus(bot.containerId)
          if (liveStatus !== bot.status) {
            await prisma.bot.update({ where: { id: bot.id }, data: { status: liveStatus } })
            return { ...bot, status: liveStatus }
          }
        }
        return bot
      }),
    )
    res.json({ bots: botsWithStatus })
  } catch {
    res.status(500).json({ error: 'Internal server error' })
  }
})

/* ── POST /api/workspaces/:wsId/bots ── */
router.post<WsParams>('/', validate(createSchema), async (req, res) => {
  const manager = await assertManagerOrAbove(req.params.wsId, req.user!.userId)
  if (!manager) { res.status(403).json({ error: 'Requires MANAGER or OWNER role' }); return }

  const { name, telegramToken, channelId } = req.body
  try {
    const bot = await prisma.bot.create({
      data: { id: uuid(), workspaceId: req.params.wsId, name, telegramToken, channelId, status: 'stopped' },
    })

    // Spawn Docker container
    try {
      const containerId = await spawnBotContainer({
        botId: bot.id,
        botName: bot.name,
        telegramToken: bot.telegramToken,
        channelId: bot.channelId,
        apiUrl: process.env.API_URL ?? `http://host.docker.internal:${process.env.PORT ?? 4000}`,
        workspaceId: req.params.wsId,
      })
      await prisma.bot.update({ where: { id: bot.id }, data: { containerId, status: 'running' } })
      res.status(201).json({ bot: { ...bot, containerId, status: 'running' } })
    } catch (dockerErr) {
      logger.error('Docker spawn failed', { err: String(dockerErr) })
      // Bot record created but container not running — return partial success
      res.status(201).json({
        bot,
        warning: 'Bot created but Docker container could not be started. Is Docker running?',
      })
    }
  } catch {
    res.status(500).json({ error: 'Internal server error' })
  }
})

/* ── POST /api/workspaces/:wsId/bots/:botId/action ── */
router.post<BotParams>('/:botId/action', async (req, res) => {
  const manager = await assertManagerOrAbove(req.params.wsId, req.user!.userId)
  if (!manager) { res.status(403).json({ error: 'Requires MANAGER or OWNER role' }); return }

  const { action } = req.body as { action: 'start' | 'stop' | 'pause' | 'resume' | 'restart' }

  try {
    const bot = await prisma.bot.findFirst({
      where: { id: req.params.botId, workspaceId: req.params.wsId },
    })
    if (!bot) { res.status(404).json({ error: 'Bot not found' }); return }

    let newStatus = bot.status

    if (action === 'stop' && bot.containerId) {
      await removeBotContainer(bot.containerId)
      newStatus = 'stopped'
      await prisma.bot.update({ where: { id: bot.id }, data: { status: newStatus, containerId: null } })
    } else if (action === 'start' && !bot.containerId) {
      const containerId = await spawnBotContainer({
        botId: bot.id,
        botName: bot.name,
        telegramToken: bot.telegramToken,
        channelId: bot.channelId,
        apiUrl: process.env.API_URL ?? `http://host.docker.internal:${process.env.PORT ?? 4000}`,
        workspaceId: req.params.wsId,
      })
      newStatus = 'running'
      await prisma.bot.update({ where: { id: bot.id }, data: { status: newStatus, containerId } })
    } else if (action === 'pause' && bot.containerId) {
      await pauseBotContainer(bot.containerId)
      newStatus = 'paused'
      await prisma.bot.update({ where: { id: bot.id }, data: { status: newStatus } })
    } else if (action === 'resume' && bot.containerId) {
      await resumeBotContainer(bot.containerId)
      newStatus = 'running'
      await prisma.bot.update({ where: { id: bot.id }, data: { status: newStatus } })
    } else if (action === 'restart' && bot.containerId) {
      await restartBotContainer(bot.containerId)
      newStatus = 'running'
      await prisma.bot.update({ where: { id: bot.id }, data: { status: newStatus } })
    }

    res.json({ bot: { ...bot, status: newStatus } })
  } catch (err) {
    logger.error('Bot action failed', { err: String(err) })
    res.status(500).json({ error: 'Action failed' })
  }
})

/* ── GET /api/workspaces/:wsId/bots/:botId/logs ── */
router.get<BotParams>('/:botId/logs', async (req, res) => {
  const manager = await assertManagerOrAbove(req.params.wsId, req.user!.userId)
  if (!manager) { res.status(403).json({ error: 'Requires MANAGER or OWNER role' }); return }

  try {
    const bot = await prisma.bot.findFirst({
      where: { id: req.params.botId, workspaceId: req.params.wsId },
    })
    if (!bot?.containerId) { res.status(404).json({ error: 'No running container' }); return }

    const logs = await getBotLogs(bot.containerId, 200)
    res.json({ logs })
  } catch {
    res.status(500).json({ error: 'Could not fetch logs' })
  }
})

/* ── DELETE /api/workspaces/:wsId/bots/:botId ── */
router.delete<BotParams>('/:botId', async (req, res) => {
  const owner = await prisma.workspaceMember.findFirst({
    where: { workspaceId: req.params.wsId, userId: req.user!.userId, role: 'OWNER' },
  })
  if (!owner) { res.status(403).json({ error: 'Only OWNER can delete bots' }); return }

  try {
    const bot = await prisma.bot.findFirst({
      where: { id: req.params.botId, workspaceId: req.params.wsId },
    })
    if (!bot) { res.status(404).json({ error: 'Bot not found' }); return }

    if (bot.containerId) await removeBotContainer(bot.containerId)
    await prisma.bot.delete({ where: { id: bot.id } })
    res.json({ message: 'Bot deleted' })
  } catch {
    res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
