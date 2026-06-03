import { spawn } from 'child_process'
import { BeatInfo, AudioSection, SectionType } from './types'

const FFMPEG   = process.env.FFMPEG_PATH   ?? 'ffmpeg'
const FFPROBE  = process.env.FFPROBE_PATH  ?? 'ffprobe'

// Analyse up to 4 minutes — covers all practical song durations
const SAMPLE_RATE       = 11025
const MAX_ANALYSIS_SEC  = 240
const ANALYSIS_TIMEOUT  = 90_000  // 90s max (longer songs need more time)

// ── Public: full audio analysis ───────────────────────────────────────────────

export async function analyseAudio(audioPath: string): Promise<BeatInfo> {
  // True duration via ffprobe (fast, exact)
  const fullDuration = await getAudioDuration(audioPath)

  const [pcm, bassPcm] = await Promise.race([
    Promise.all([
      extractPCM(audioPath, SAMPLE_RATE, MAX_ANALYSIS_SEC),
      extractPCM(audioPath, SAMPLE_RATE, MAX_ANALYSIS_SEC, 'highpass=f=30,lowpass=f=150'),
    ]),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('audio-analysis-timeout')), ANALYSIS_TIMEOUT),
    ),
  ])

  const analysedDuration = pcm.length / SAMPLE_RATE
  const duration = fullDuration > 0 ? fullDuration : analysedDuration

  const { beats, bpm } = detectBeats(pcm, SAMPLE_RATE)
  const energyProfile   = buildEnergyProfile(pcm, SAMPLE_RATE)
  const drops           = findDrops(energyProfile)
  const sections        = segmentSections(energyProfile, analysedDuration)
  const transients      = detectTransients(pcm, SAMPLE_RATE)
  const bassHits        = detectBassHits(bassPcm, SAMPLE_RATE, bpm)

  return { bpm, beats, drops, transients, bassHits, sections, duration }
}

/**
 * Find the optimal audio start offset for a window of `targetDuration` seconds.
 * Scores each possible window based on section type / energy / drops / beats.
 * Returns the start time (seconds) of the best window.
 * Returns 0 if the audio is already short enough.
 */
export function findBestAudioSegment(beatInfo: BeatInfo, targetDuration: number): number {
  const { sections, drops, beats, bpm, duration } = beatInfo
  if (targetDuration >= duration - 0.5) return 0

  const STEP = 0.25 // 250ms resolution
  let bestScore = -Infinity
  let bestOffset = 0

  const typeWeight: Partial<Record<SectionType, number>> = {
    chorus: 3.5,
    drop:   3.0,
    verse:  1.5,
    bridge: 1.0,
    intro:  0.15,
    outro:  0.05,
  }

  for (let offset = 0; offset + targetDuration <= duration; offset += STEP) {
    const end = offset + targetDuration
    let score = 0

    // Section coverage score
    for (const s of sections) {
      const overlap = Math.min(s.end, end) - Math.max(s.start, offset)
      if (overlap <= 0) continue
      score += s.energy * (typeWeight[s.type] ?? 1.0) * (overlap / targetDuration)
    }

    // Drop bonus (each drop in window = big energy moment)
    score += drops.filter(d => d >= offset && d < end).length * 1.2

    // Beat-alignment bonus (start on a beat → clean entry)
    const beatInterval = bpm > 0 ? 60 / bpm : 0.5
    const alignedBeat  = beats.find(b => b >= offset && b < offset + beatInterval * 1.5)
    if (alignedBeat !== undefined) score += 0.4

    // Penalty for starting in intro/outro
    const startSec = sections.find(s => offset >= s.start && offset < s.end)
    if (startSec?.type === 'intro' || startSec?.type === 'outro') score -= 3.0

    if (score > bestScore) { bestScore = score; bestOffset = offset }
  }

  // Snap to closest beat for a clean cut-in point
  const beatInterval = bpm > 0 ? 60 / bpm : 0.5
  const snapRadius   = beatInterval * 0.6
  const snapBeat     = beats.find(b => Math.abs(b - bestOffset) <= snapRadius)
  return snapBeat !== undefined ? snapBeat : bestOffset
}

// ── Private: audio duration via ffprobe ──────────────────────────────────────

function getAudioDuration(audioPath: string): Promise<number> {
  return new Promise(resolve => {
    const proc = spawn(FFPROBE, [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      audioPath,
    ], { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    proc.stdout.on('data', (d: Buffer) => { out += d.toString() })
    proc.on('close', () => { const d = parseFloat(out.trim()); resolve(isNaN(d) ? 0 : d) })
    proc.on('error', () => resolve(0))
  })
}

// ── Private: PCM extraction ───────────────────────────────────────────────────

function extractPCM(
  audioPath: string,
  sampleRate: number,
  maxDurationSec?: number,
  audioFilter?: string,
): Promise<Float32Array> {
  return new Promise((resolve, reject) => {
    const args: string[] = []
    if (maxDurationSec) args.push('-t', String(maxDurationSec))
    args.push('-i', audioPath)
    if (audioFilter) args.push('-af', audioFilter)
    args.push('-ac', '1', '-ar', String(sampleRate), '-f', 'f32le', 'pipe:1')

    const proc = spawn(FFMPEG, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    const chunks: Buffer[] = []

    proc.stdout.on('data', (chunk: Buffer) => chunks.push(chunk))
    proc.stderr.on('data', () => {})
    proc.on('close', (code) => {
      if (code !== 0 && chunks.length === 0) {
        reject(new Error(`FFmpeg PCM extraction failed (code ${code})`)); return
      }
      const buf = Buffer.concat(chunks)
      resolve(new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4))
    })
    proc.on('error', (e) => reject(new Error(`FFmpeg spawn error: ${e.message}`)))
  })
}

// ── Private: beat detection ───────────────────────────────────────────────────

function detectBeats(pcm: Float32Array, sampleRate: number): { beats: number[]; bpm: number } {
  const windowSize = Math.floor(sampleRate * 0.023)
  const hopSize    = Math.floor(windowSize / 2)
  const energies: number[] = []

  for (let i = 0; i + windowSize < pcm.length; i += hopSize) {
    let sum = 0
    for (let j = i; j < i + windowSize; j++) sum += pcm[j] * pcm[j]
    energies.push(Math.sqrt(sum / windowSize))
  }

  const avg       = mean(energies)
  const threshold = avg * 1.4
  const rawBeats: number[] = []

  for (let i = 1; i < energies.length - 1; i++) {
    if (energies[i] > energies[i - 1] && energies[i] > energies[i + 1] && energies[i] > threshold) {
      rawBeats.push((i * hopSize) / sampleRate)
    }
  }

  const beats         = suppressClose(rawBeats, 0.2)
  const intervals     = beats.slice(1).map((b, i) => b - beats[i])
  const medianInterval = median(intervals)
  let bpm = medianInterval > 0 ? 60 / medianInterval : 120
  while (bpm < 60)  bpm *= 2
  while (bpm > 200) bpm /= 2

  return { beats, bpm: Math.round(bpm) }
}

// ── Private: bass hit detection (sub-bass / kick / 808 peaks) ────────────────

function detectBassHits(bassPcm: Float32Array, sampleRate: number, bpm: number): number[] {
  const WIN_MS   = 12   // 12ms analysis window
  const HOP_MS   = 6    // 6ms hop → ~167 bins/sec
  const WIN_SIZE = Math.floor(sampleRate * WIN_MS / 1000)
  const HOP_SIZE = Math.floor(sampleRate * HOP_MS / 1000)

  // RMS envelope
  const rms: number[] = []
  for (let i = 0; i + WIN_SIZE < bassPcm.length; i += HOP_SIZE) {
    let s = 0
    for (let j = i; j < i + WIN_SIZE; j++) s += bassPcm[j] * bassPcm[j]
    rms.push(Math.sqrt(s / WIN_SIZE))
  }

  // Smooth to reduce noise (3-bin moving average)
  const smooth = rms.map((_, i) => {
    const sl = rms.slice(Math.max(0, i - 2), i + 3)
    return sl.reduce((a, b) => a + b, 0) / sl.length
  })

  const avg       = mean(smooth)
  const p85       = percentile(smooth, 0.85)
  const threshold = Math.max(avg * 1.6, p85 * 0.75)  // strong peak threshold
  const MIN_GAP   = bpm > 0 ? (60 / bpm) * 0.4 : 0.15  // at least 40% of a beat interval

  const hits: number[] = []
  let lastT = -MIN_GAP

  for (let i = 2; i < smooth.length - 2; i++) {
    const t = (i * HOP_SIZE) / sampleRate
    const isPeak = smooth[i] > smooth[i - 1] && smooth[i] > smooth[i + 1]
               && smooth[i] > smooth[i - 2] && smooth[i] > threshold
    if (isPeak && t - lastT >= MIN_GAP) {
      hits.push(t)
      lastT = t
    }
  }

  return hits
}

// ── Private: energy profile ───────────────────────────────────────────────────

function buildEnergyProfile(pcm: Float32Array, sampleRate: number): Array<{ time: number; energy: number }> {
  const windowSize  = Math.floor(sampleRate * 0.1)
  const rmsValues: number[] = []
  let maxRms = 0

  for (let i = 0; i + windowSize < pcm.length; i += windowSize) {
    let sum = 0
    for (let j = i; j < i + windowSize; j++) sum += pcm[j] * pcm[j]
    const rms = Math.sqrt(sum / windowSize)
    rmsValues.push(rms)
    if (rms > maxRms) maxRms = rms
  }

  return rmsValues.map((rms, idx) => ({
    time:   (idx * windowSize) / sampleRate,
    energy: maxRms > 0 ? rms / maxRms : 0,
  }))
}

// ── Private: drop detection ───────────────────────────────────────────────────

function findDrops(profile: Array<{ time: number; energy: number }>): number[] {
  const DROP_THRESHOLD = 0.75
  const MIN_GAP        = 10
  const drops: number[] = []
  let lastDrop = -MIN_GAP

  for (let i = 2; i < profile.length - 2; i++) {
    const t = profile[i].time
    if (
      profile[i].energy > DROP_THRESHOLD &&
      profile[i].energy >= profile[i - 1].energy &&
      profile[i].energy >= profile[i + 1].energy &&
      t - lastDrop > MIN_GAP
    ) {
      drops.push(t)
      lastDrop = t
    }
  }
  return drops
}

// ── Private: section segmentation ────────────────────────────────────────────

function segmentSections(
  profile: Array<{ time: number; energy: number }>,
  duration: number,
): AudioSection[] {
  const SMOOTH_BINS = 30
  const smoothed: number[] = []
  for (let i = 0; i < profile.length; i++) {
    const s = Math.max(0, i - SMOOTH_BINS)
    const e = Math.min(profile.length, i + SMOOTH_BINS)
    smoothed.push(mean(profile.slice(s, e).map((v) => v.energy)))
  }

  const avgEnergy = mean(smoothed)
  const sections: AudioSection[] = []
  const SECTION_MIN = 4
  let sectionStart = 0
  let currentType: SectionType = 'intro'
  let blockCount = 0

  for (let i = 0; i < smoothed.length; i++) {
    const t       = (i * 100) / 1000
    const e       = smoothed[i]
    const relPos  = t / duration
    let type: SectionType

    if (relPos < 0.08)        type = 'intro'
    else if (relPos > 0.9)    type = 'outro'
    else if (e > avgEnergy * 1.3) type = blockCount % 2 === 0 ? 'chorus' : 'drop'
    else if (e < avgEnergy * 0.6) type = 'bridge'
    else                          type = 'verse'

    if (type !== currentType) {
      const sectionEnd = t
      if (sectionEnd - sectionStart >= SECTION_MIN) {
        const sliceE = smoothed.slice(
          Math.floor((sectionStart / duration) * smoothed.length),
          Math.floor((sectionEnd   / duration) * smoothed.length),
        )
        sections.push({ type: currentType, start: sectionStart, end: sectionEnd, energy: mean(sliceE) })
        sectionStart = sectionEnd
        blockCount++
      }
      currentType = type
    }
  }

  if (duration - sectionStart > 0) {
    sections.push({
      type: currentType, start: sectionStart, end: duration,
      energy: mean(smoothed.slice(Math.floor((sectionStart / duration) * smoothed.length))),
    })
  }
  return sections
}

// ── Private: transient detection ─────────────────────────────────────────────

function detectTransients(pcm: Float32Array, sampleRate: number): number[] {
  const HOP_MS   = 10
  const hopSize  = Math.floor(sampleRate * (HOP_MS / 1000))
  const winSize  = hopSize * 2
  const alpha    = 0.9
  const hp       = new Float32Array(pcm.length)
  let prev = 0
  for (let i = 0; i < pcm.length; i++) {
    hp[i] = alpha * (prev + pcm[i] - (i > 0 ? pcm[i - 1] : 0))
    prev = hp[i]
  }

  const rms: number[] = []
  for (let i = 0; i + winSize < hp.length; i += hopSize) {
    let s = 0
    for (let j = i; j < i + winSize; j++) s += hp[j] * hp[j]
    rms.push(Math.sqrt(s / winSize))
  }

  const onset: number[] = [0]
  for (let i = 1; i < rms.length; i++) onset.push(Math.max(0, rms[i] - rms[i - 1]))

  const avgOnset    = mean(onset)
  const threshold   = avgOnset * 2.5
  const MIN_GAP_MS  = 50
  const minGapBins  = Math.ceil(MIN_GAP_MS / HOP_MS)
  const transients: number[] = []
  let lastBin = -minGapBins

  for (let i = 1; i < onset.length - 1; i++) {
    if (onset[i] > onset[i - 1] && onset[i] > onset[i + 1] && onset[i] > threshold && i - lastBin >= minGapBins) {
      transients.push((i * hopSize) / sampleRate)
      lastBin = i
    }
  }
  return transients
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function mean(arr: number[]): number {
  if (arr.length === 0) return 0
  return arr.reduce((a, b) => a + b, 0) / arr.length
}

function median(arr: number[]): number {
  if (arr.length === 0) return 0
  const s = [...arr].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 === 0 ? (s[m - 1] + s[m]) / 2 : s[m]
}

function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0
  const s = [...arr].sort((a, b) => a - b)
  return s[Math.floor(s.length * p)] ?? s[s.length - 1]
}


function suppressClose(beats: number[], minGap: number): number[] {
  const result: number[] = []
  let last = -Infinity
  for (const b of beats) {
    if (b - last >= minGap) { result.push(b); last = b }
  }
  return result
}
