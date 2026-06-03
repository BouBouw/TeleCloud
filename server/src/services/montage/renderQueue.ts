/**
 * Montage render queue – polls for QUEUED jobs and runs the engine.
 */
import prisma from '../../lib/prisma'
import { runMontageEngine } from './engine'

const POLL_INTERVAL_MS = 4000
let activeJobs = 0
const MAX_WORKERS = Number(process.env.MONTAGE_MAX_WORKERS ?? 2)
let pollTimer: ReturnType<typeof setInterval> | null = null

export const montageQueue = {
  async enqueue(projectId: string) {
    const job = await prisma.montageRenderJob.upsert({
      where: { projectId },
      create: { projectId, status: 'QUEUED', progress: 0, logs: '', currentStep: '' },
      update: { status: 'QUEUED', progress: 0, logs: '', currentStep: '', error: null, startedAt: null, finishedAt: null },
    })
    await prisma.montageProject.update({ where: { id: projectId }, data: { status: 'QUEUED' } })
    return job
  },

  start() {
    if (pollTimer) return
    pollTimer = setInterval(tick, POLL_INTERVAL_MS)
    console.log('[MontageQueue] Started')
  },

  stop() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
  },
}

async function tick() {
  if (activeJobs >= MAX_WORKERS) return
  try {
    const job = await prisma.montageRenderJob.findFirst({
      where: { status: 'QUEUED' },
      orderBy: { createdAt: 'asc' },
    })
    if (!job) return
    activeJobs++
    processJob(job).finally(() => { activeJobs-- })
  } catch (err) {
    console.error('[MontageQueue] Poll error:', err)
  }
}

async function processJob(job: { id: string; projectId: string; logs: string }) {
  const { id: jobId, projectId } = job

  await prisma.montageRenderJob.update({
    where: { id: jobId },
    data: { status: 'RUNNING', currentStep: 'STARTING', startedAt: new Date() },
  })
  await prisma.montageProject.update({ where: { id: projectId }, data: { status: 'PROCESSING' } })

  const log = async (step: string, progress: number, message: string) => {
    const logLine = `[${new Date().toISOString()}] [${step}] ${message}\n`
    console.log('[MontageJob %s]', jobId, message)
    await prisma.montageRenderJob.update({
      where: { id: jobId },
      data: { progress, currentStep: step, logs: { set: job.logs + logLine } },
    }).catch(() => {})
  }

  try {
    await runMontageEngine(projectId, log)
    await prisma.montageRenderJob.update({
      where: { id: jobId },
      data: { status: 'DONE', progress: 100, currentStep: 'COMPLETED', finishedAt: new Date() },
    })
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err)
    console.error('[MontageQueue] Job %s FAILED:', jobId, errMsg)
    await prisma.montageRenderJob.update({
      where: { id: jobId },
      data: { status: 'FAILED', currentStep: 'FAILED', error: errMsg, finishedAt: new Date() },
    }).catch(() => {})
    await prisma.montageProject.update({ where: { id: projectId }, data: { status: 'FAILED' } }).catch(() => {})
  }
}
