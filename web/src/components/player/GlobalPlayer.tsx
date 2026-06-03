import { useRef, useEffect, useState, useCallback } from 'react'
import {
  Play, Pause, SkipBack, SkipForward,
  Volume2, VolumeX, Repeat, Shuffle,
  Music2,
} from 'lucide-react'
import { usePlayerStore } from '../../store/playerStore'

const S = {
  bg:       '#111',
  panel:    '#1a1a1a',
  border:   '#2a2a2a',
  borderHi: '#3a3a3a',
  accent:   '#f0a830',
  text:     '#ccc',
  textDim:  '#888',
  textMute: '#555',
  textFade: '#333',
  input:    '#0a0a0a',
}

export default function GlobalPlayer() {
  const { track, isPlaying, volume, setVolume, togglePlay, seek } = usePlayerStore()
  const audioRef    = useRef<HTMLAudioElement>(null)
  const canvasRef   = useRef<HTMLCanvasElement>(null)
  const animRef     = useRef<number>(0)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const ctxRef      = useRef<AudioContext | null>(null)
  const sourceRef   = useRef<MediaElementAudioSourceNode | null>(null)

  const [currentTime, setCurrentTime] = useState(0)
  const [duration,    setDuration]    = useState(0)
  const [muted,       setMuted]       = useState(false)
  const [repeat,      setRepeat]      = useState(false)
  const [shuffle,     setShuffle]     = useState(false)
  const [hovProg,     setHovProg]     = useState(false)

  /* ── Init Web Audio analyser ── */
  useEffect(() => {
    const audio = audioRef.current
    if (!audio || ctxRef.current) return
    const ctx      = new AudioContext()
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 256
    const source = ctx.createMediaElementSource(audio)
    source.connect(analyser)
    analyser.connect(ctx.destination)
    ctxRef.current      = ctx
    analyserRef.current = analyser
    sourceRef.current   = source
  }, [])

  /* ── Draw waveform (orange bars) ── */
  const drawWaveform = useCallback(() => {
    const canvas   = canvasRef.current
    const analyser = analyserRef.current
    if (!canvas || !analyser) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const bufferLength = analyser.frequencyBinCount
    const dataArray    = new Uint8Array(bufferLength)
    const W = canvas.width
    const H = canvas.height

    const draw = () => {
      animRef.current = requestAnimationFrame(draw)
      analyser.getByteFrequencyData(dataArray)
      ctx.clearRect(0, 0, W, H)
      const barW = (W / bufferLength) * 2.5
      let x = 0
      for (let i = 0; i < bufferLength; i++) {
        const barH = (dataArray[i] / 255) * H
        const alpha = 0.5 + (dataArray[i] / 255) * 0.5
        ctx.fillStyle = `rgba(240,168,48,${alpha})`
        ctx.fillRect(x, H - barH, Math.max(barW - 1, 1), barH)
        x += barW
      }
    }
    draw()
  }, [])

  useEffect(() => { audioRef.current?.load() }, [track?.url])

  useEffect(() => {
    if (!isPlaying) {
      audioRef.current?.pause()
      cancelAnimationFrame(animRef.current)
      return () => cancelAnimationFrame(animRef.current)
    }
    let cancelled = false
    const start = async () => {
      const ctx = ctxRef.current
      if (ctx && ctx.state !== 'running') await ctx.resume()
      if (cancelled) return
      await audioRef.current?.play().catch(() => {})
      if (!cancelled) drawWaveform()
    }
    start()
    return () => { cancelled = true; cancelAnimationFrame(animRef.current) }
  }, [isPlaying, track?.url, drawWaveform])

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = muted ? 0 : volume
  }, [volume, muted])

  const fmt = (s: number) =>
    `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

  const handleProgress = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const pct  = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    if (audioRef.current) audioRef.current.currentTime = pct * duration
    seek(pct * duration)
  }

  if (!track) return null

  const pct = duration ? (currentTime / duration) * 100 : 0

  return (
    <div style={{ background: S.bg, borderTop: `1px solid ${S.border}` }}>

      <audio
        ref={audioRef}
        src={track.url}
        onTimeUpdate={e => setCurrentTime((e.target as HTMLAudioElement).currentTime)}
        onLoadedMetadata={e => setDuration((e.target as HTMLAudioElement).duration)}
        onEnded={() => { if (repeat && audioRef.current) { audioRef.current.play() } }}
      />

      {/* Progress bar */}
      <div
        className="relative cursor-pointer"
        style={{ height: hovProg ? '4px' : '2px', transition: 'height 0.15s', background: S.border }}
        onClick={handleProgress}
        onMouseEnter={() => setHovProg(true)}
        onMouseLeave={() => setHovProg(false)}
      >
        <div
          className="h-full transition-all"
          style={{ width: `${pct}%`, background: S.accent }}
        />
        {hovProg && (
          <div
            className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full"
            style={{ left: `${pct}%`, marginLeft: '-6px', background: S.accent, boxShadow: `0 0 6px ${S.accent}88` }}
          />
        )}
      </div>

      {/* Main bar */}
      <div className="flex items-center gap-4 px-5" style={{ height: '56px' }}>

        {/* Track info */}
        <div className="flex items-center gap-3 shrink-0" style={{ width: '220px' }}>
          <div
            className="w-8 h-8 rounded overflow-hidden shrink-0 flex items-center justify-center"
            style={{ background: S.panel, border: `1px solid ${S.border}` }}
          >
            {track.artwork
              ? <img src={track.artwork} alt="" className="w-full h-full object-cover" />
              : <Music2 size={13} style={{ color: S.textFade }} />
            }
          </div>
          <div className="min-w-0">
            <p className="text-xs font-semibold truncate" style={{ color: S.text }}>{track.title}</p>
            <p className="text-[10px] truncate mt-0.5" style={{ color: S.textMute }}>{track.artist ?? ''}</p>
          </div>
        </div>

        {/* Controls */}
        <div className="flex-1 flex items-center justify-center gap-3">
          <button
            onClick={() => setShuffle(s => !s)}
            className="p-1.5 rounded transition-colors"
            style={{ color: shuffle ? S.accent : S.textFade }}
            title="Shuffle"
          >
            <Shuffle size={13} />
          </button>

          <button
            className="p-1.5 rounded transition-colors hover:brightness-150"
            style={{ color: S.textMute }}
          >
            <SkipBack size={16} />
          </button>

          <button
            onClick={togglePlay}
            className="flex items-center justify-center rounded-full transition-all hover:brightness-110 active:scale-95"
            style={{ width: '34px', height: '34px', background: S.accent, flexShrink: 0 }}
          >
            {isPlaying
              ? <Pause  size={15} style={{ color: '#000' }} />
              : <Play   size={15} style={{ color: '#000', transform: 'translateX(1px)' }} />
            }
          </button>

          <button
            className="p-1.5 rounded transition-colors hover:brightness-150"
            style={{ color: S.textMute }}
          >
            <SkipForward size={16} />
          </button>

          <button
            onClick={() => setRepeat(r => !r)}
            className="p-1.5 rounded transition-colors"
            style={{ color: repeat ? S.accent : S.textFade }}
            title="Repeat"
          >
            <Repeat size={13} />
          </button>
        </div>

        {/* Time + waveform + volume */}
        <div className="flex items-center gap-3 shrink-0 justify-end" style={{ width: '220px' }}>

          <span className="text-[10px] tabular-nums font-mono" style={{ color: S.textFade }}>
            {fmt(currentTime)}
            <span style={{ color: S.textFade, margin: '0 2px' }}>/</span>
            {fmt(duration)}
          </span>

          <canvas
            ref={canvasRef}
            width={64}
            height={24}
            className="rounded"
            style={{ opacity: isPlaying ? 1 : 0.3, transition: 'opacity 0.3s' }}
          />

          <button
            onClick={() => setMuted(m => !m)}
            className="transition-colors hover:brightness-150"
            style={{ color: S.textMute }}
          >
            {muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
          </button>

          <div className="relative flex items-center" style={{ width: '64px' }}>
            <div
              className="absolute h-0.5 rounded-full pointer-events-none"
              style={{ width: `${(muted ? 0 : volume) * 100}%`, background: S.accent, left: 0 }}
            />
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={muted ? 0 : volume}
              onChange={e => { setMuted(false); setVolume(Number(e.target.value)) }}
              className="w-full"
              style={{
                appearance: 'none' as const,
                background: 'transparent',
                height: '2px',
                accentColor: S.accent,
                cursor: 'pointer',
              }}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
