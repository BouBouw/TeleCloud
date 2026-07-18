import Docker from 'dockerode'
import logger from '../lib/logger'

const docker = new Docker(
  process.env.DOCKER_HOST
    ? { socketPath: process.env.DOCKER_HOST }          // explicit override
    : process.platform === 'win32'
      ? { socketPath: '//./pipe/docker_engine' }       // Docker Desktop Windows named pipe
      : { socketPath: process.env.DOCKER_SOCKET ?? '/var/run/docker.sock' },
)

export interface BotContainerConfig {
  botId: string
  botName: string
  telegramToken: string
  channelId: string
  apiUrl: string
  workspaceId: string
  reaction?: string | null
}

const IMAGE_NAME = process.env.BOT_IMAGE_NAME ?? 'vibot-bot:latest'

/**
 * Spawn a new Docker container for a bot.
 * Returns the Docker container ID.
 */
export async function spawnBotContainer(cfg: BotContainerConfig): Promise<string> {
  logger.info(`Spawning bot container for bot ${cfg.botId}`)

  const container = await docker.createContainer({
    Image: IMAGE_NAME,
    name: `vibot-bot-${cfg.botId}`,
    Env: [
      `TELEGRAM_TOKEN=${cfg.telegramToken}`,
      `CHANNEL_ID=${cfg.channelId}`,
      `BOT_ID=${cfg.botId}`,
      `WORKSPACE_ID=${cfg.workspaceId}`,
      `API_URL=${cfg.apiUrl}`,
      ...(cfg.reaction ? [`REACTION=${cfg.reaction}`] : []),
    ],
    HostConfig: {
      RestartPolicy: { Name: 'unless-stopped' },
      NetworkMode: 'bridge',
    },
    Labels: {
      'vibot.bot': 'true',
      'vibot.botId': cfg.botId,
      'vibot.workspaceId': cfg.workspaceId,
    },
  })

  await container.start()
  const info = await container.inspect()
  logger.info(`Bot container started: ${info.Id.substring(0, 12)}`)
  return info.Id
}

/**
 * Stop and remove a bot container.
 */
export async function removeBotContainer(containerId: string): Promise<void> {
  try {
    const container = docker.getContainer(containerId)
    const info = await container.inspect()

    if (info.State.Running) {
      await container.stop({ t: 5 })
    }
    await container.remove()
    logger.info(`Removed container ${containerId.substring(0, 12)}`)
  } catch (err) {
    logger.warn(`Could not remove container ${containerId}`, { err: String(err) })
  }
}

/**
 * Pause/resume a bot container.
 */
export async function pauseBotContainer(containerId: string): Promise<void> {
  const container = docker.getContainer(containerId)
  await container.pause()
}

export async function resumeBotContainer(containerId: string): Promise<void> {
  const container = docker.getContainer(containerId)
  await container.unpause()
}

/**
 * Restart a bot container.
 */
export async function restartBotContainer(containerId: string): Promise<void> {
  const container = docker.getContainer(containerId)
  await container.restart({ t: 5 })
}

/**
 * Get the running status of a container.
 */
export async function getContainerStatus(
  containerId: string,
): Promise<'running' | 'paused' | 'stopped' | 'error'> {
  try {
    const container = docker.getContainer(containerId)
    const info = await container.inspect()
    if (info.State.Paused) return 'paused'
    if (info.State.Running) return 'running'
    return 'stopped'
  } catch {
    return 'error'
  }
}

/**
 * Get logs from a bot container.
 */
export async function getBotLogs(containerId: string, tail = 100): Promise<string> {
  try {
    const container = docker.getContainer(containerId)
    const stream = await container.logs({ stdout: true, stderr: true, tail })
    return stream.toString()
  } catch (err) {
    return `Could not fetch logs: ${String(err)}`
  }
}
