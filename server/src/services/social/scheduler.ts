/**
 * Social post scheduler.
 * Polls every 30 seconds for posts due within the next minute and publishes them.
 * Posts 1 minute early so they go out exactly on time (or before).
 */
import path from 'path'
import prisma from '../../lib/prisma'
import logger from '../../lib/logger'
import { publishVideo } from './publisher'

const STORAGE_ROOT = path.resolve(process.env.STORAGE_PATH ?? './storage')

let schedulerTimer: ReturnType<typeof setInterval> | null = null

export function startScheduler(): void {
  if (schedulerTimer) return
  schedulerTimer = setInterval(runScheduledPosts, 30_000)
  logger.info('[scheduler] Social post scheduler started (30s interval, 1min early)')
}

export function stopScheduler(): void {
  if (schedulerTimer) {
    clearInterval(schedulerTimer)
    schedulerTimer = null
    logger.info('[scheduler] Social post scheduler stopped')
  }
}

async function runScheduledPosts(): Promise<void> {
  // Post 1 minute early — anything scheduled at or before (now + 60s) is due
  const cutoff = new Date(Date.now() + 60_000)

  try {
    const duePosts = await prisma.socialPost.findMany({
      where: {
        status: 'PENDING',
        scheduledAt: { not: null, lte: cutoff },
      },
      include: {
        account: { select: { accessToken: true, refreshToken: true } },
        project: { select: { outputPath: true, id: true } },
      },
    })

    if (duePosts.length === 0) return
    logger.info(`[scheduler] ${duePosts.length} post(s) to publish`)

    for (const post of duePosts) {
      // Mark as publishing immediately to prevent double-execution
      await prisma.socialPost.update({
        where: { id: post.id },
        data: { status: 'PUBLISHING' },
      })

      try {
        if (!post.project.outputPath) throw new Error('Montage output non disponible')
        const videoPath = path.join(STORAGE_ROOT, post.project.outputPath)
        const caption = post.caption ?? ''
        const hashtags = post.hashtags ?? ''

        const result = await publishVideo(post.platform, {
          accessToken:  post.account.accessToken,
          refreshToken: post.account.refreshToken ?? undefined,
          videoPath,
          caption: `${caption}\n${hashtags}`.trim(),
          hashtags,
          platform: post.platform,
        })

        await prisma.socialPost.update({
          where: { id: post.id },
          data: {
            status: 'DONE',
            publishedAt: new Date(),
            publishedUrl: result.url ?? null,
          },
        })
        logger.info(`[scheduler] Posted project ${post.projectId} to ${post.platform}: ${result.postId}`)
      } catch (err: any) {
        await prisma.socialPost.update({
          where: { id: post.id },
          data: { status: 'FAILED', error: err.message },
        })
        logger.error(`[scheduler] Failed to post ${post.id} to ${post.platform}: ${err.message}`)
      }
    }
  } catch (err: any) {
    logger.error(`[scheduler] Scheduler error: ${err.message}`)
  }
}
