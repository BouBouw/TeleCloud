/**
 * In-memory queue for YouTube download jobs delegated to the local tunnel.
 *
 * When the tunnel CLI is running on the user's machine, YouTube downloads are
 * queued here instead of being attempted directly on the VPS (whose IP is
 * flagged by YouTube). The tunnel CLI polls /api/tunnel/jobs/next, downloads
 * via yt-dlp --cookies-from-browser on the user's machine, then POSTs the
 * file back to /api/tunnel/jobs/:id/complete.
 */

import { EventEmitter } from 'events'
import { randomUUID } from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'

export type JobStatus = 'pending' | 'running' | 'done' | 'failed'
export type JobFormat = 'MP3' | 'MP4' | 'MONTAGE'

export interface JobMeta {
  ytId:      string
  title:     string
  uploader?: string
  thumbnail?: string
  duration?: number
  webpage_url: string
}

export interface TunnelJob {
  id:           string
  wsId:         string
  userId:       string
  url:          string
  outputFormat: JobFormat
  /** For MONTAGE jobs: the MontageSourceVideo ID to update on completion */
  svId?:        string
  meta:         JobMeta
  status:       JobStatus
  error?:       string
  result?: {
    trackId?: string
    videoId?: string
    /** For MONTAGE jobs: local path stored on server */
    localPath?: string
    title:    string
  }
  createdAt: Date
  updatedAt: Date
}

// ── State ──────────────────────────────────────────────────────────────────────

const jobs = new Map<string, TunnelJob>()
let lastHeartbeat = 0

/** File used to share heartbeat across PM2 cluster workers / restarts */
const HB_FILE = path.join(os.tmpdir(), 'vibot-tunnel-heartbeat')

/** Emits 'done:<jobId>' and 'fail:<jobId>' when a job finishes */
export const tunnelEvents = new EventEmitter()

// ── Heartbeat ──────────────────────────────────────────────────────────────────

export function setHeartbeat(): void {
  lastHeartbeat = Date.now()
  try { fs.writeFileSync(HB_FILE, lastHeartbeat.toString()) } catch { /* ignore */ }
}

/** Returns true if the tunnel sent a heartbeat within the last 30 seconds */
export function isTunnelActive(): boolean {
  // Check in-memory first (fastest path — same worker, no crash)
  if (Date.now() - lastHeartbeat < 30_000) return true
  // Fall back to file — handles PM2 worker restarts and cluster siblings
  try {
    const ts = parseInt(fs.readFileSync(HB_FILE, 'utf8'), 10)
    if (Date.now() - ts < 30_000) {
      lastHeartbeat = ts // resync in-memory
      return true
    }
  } catch { /* file not found = no tunnel */ }
  return false
}

export function getTunnelAge(): number {
  return lastHeartbeat ? Date.now() - lastHeartbeat : -1
}

// ── Job management ─────────────────────────────────────────────────────────────

export function createJob(
  wsId: string,
  userId: string,
  url: string,
  outputFormat: JobFormat,
  meta: JobMeta,
  svId?: string,
): TunnelJob {
  const id = randomUUID()
  const now = new Date()
  const job: TunnelJob = {
    id, wsId, userId, url, outputFormat, meta, svId,
    status: 'pending',
    createdAt: now,
    updatedAt: now,
  }
  jobs.set(id, job)
  // Auto-remove after 15 minutes regardless of outcome
  setTimeout(() => jobs.delete(id), 15 * 60_000)
  return job
}

/** Dequeues the oldest pending job and marks it as running. Returns null if none. */
export function claimNextJob(): TunnelJob | null {
  for (const job of jobs.values()) {
    if (job.status === 'pending') {
      job.status = 'running'
      job.updatedAt = new Date()
      return job
    }
  }
  return null
}

export function getJob(id: string): TunnelJob | null {
  return jobs.get(id) ?? null
}

export function markDone(id: string, result: TunnelJob['result']): void {
  const job = jobs.get(id)
  if (!job) return
  job.status = 'done'
  job.result = result
  job.updatedAt = new Date()
  tunnelEvents.emit(`done:${id}`, job)
}

export function markFailed(id: string, error: string): void {
  const job = jobs.get(id)
  if (!job) return
  job.status = 'failed'
  job.error = error
  job.updatedAt = new Date()
  tunnelEvents.emit(`fail:${id}`, job)
}

/** Expose safe job summary for the frontend */
export function jobSummary(job: TunnelJob) {
  return {
    id:           job.id,
    status:       job.status,
    outputFormat: job.outputFormat,
    meta:         job.meta,
    error:        job.error,
    result:       job.result,
    updatedAt:    job.updatedAt,
  }
}
