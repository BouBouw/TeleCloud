import { useState, useRef } from 'react'
import { Link2, Music, Film, Loader2, Check, Download, X, PlayCircle, Clock, Wifi } from 'lucide-react'
import { trackApi, tunnelApi } from '../lib/api'
import type { SocialResult, Track } from '../lib/api'

const S = {
  panel:    '#1a1a1a',
  panelAlt: '#161616',
  border:   '#2a2a2a',
  accent:   '#f0a830',
  text:     '#ccc',
  textDim:  '#888',
  textMute: '#555',
  textFade: '#333',
  input:    '#0a0a0a',
  red:      '#e74c3c',
  green:    '#2eb872',
}

const YT_ACCENT = '#FF0000'

type OutputFormat = 'MP3' | 'MP4'

function fmtDuration(s?: number) {
  if (!s) return undefined
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = Math.floor(s % 60)
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
    : `${m}:${String(sec).padStart(2, '0')}`
}

function isYouTubeUrl(url: string) {
  return /(youtube\.com\/watch|youtube\.com\/shorts|youtu\.be\/)/i.test(url)
}

interface Props {
  workspaceId     : string
  onScrapeSuccess?: () => void
  libraryTracks?  : Track[]
}

export default function YouTubeSearch({ workspaceId, onScrapeSuccess, libraryTracks }: Props) {
  const [url,        setUrl]        = useState('')
  const [format,     setFormat]     = useState<OutputFormat>('MP3')
  const [preview,    setPreview]    = useState<SocialResult | null>(null)
  const [loading,    setLoading]    = useState(false)
  const [scraping,   setScraping]   = useState(false)
  const [error,      setError]      = useState('')
  const [success,    setSuccess]    = useState('')
  const [queued,     setQueued]     = useState<{ jobId: string; title: string } | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const inLibrary = preview
    ? (libraryTracks ?? []).some(tr => tr.soundcloudUrl === preview.permalink_url)
    : false

  const handleUrlChange = (v: string) => {
    setUrl(v)
    setError('')
    setPreview(null)
    setSuccess('')
  }

  const handleResolve = async () => {
    const trimmed = url.trim()
    if (!trimmed) return
    if (!isYouTubeUrl(trimmed)) {
      setError('Colle un lien YouTube (youtube.com/watch, /shorts, ou youtu.be)')
      return
    }
    setLoading(true)
    setError('')
    setPreview(null)
    try {
      const { result } = await trackApi.resolveSocial(workspaceId, trimmed)
      setPreview(result)
    } catch (e) {
      const raw = String(e).replace('Error: ', '')
      setError(raw.includes('Sign in') || raw.includes('bot') ? 'Vidéo non accessible sans connexion YouTube (vidéo privée ou age-restricted).' : raw.split('\n')[0].slice(0, 200))
    } finally {
      setLoading(false)
    }
  }

  const stopPolling = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
  }

  const handleDownload = async () => {
    const trimmed = url.trim()
    if (!trimmed) return
    setScraping(true)
    setError('')
    setQueued(null)
    try {
      const result = await trackApi.scrapeSocial(workspaceId, trimmed, format)

      // Tunnel path: server queued the job for local download
      if (result.status === 'queued' && result.jobId) {
        const title = result.meta?.title ?? preview?.title ?? trimmed
        setQueued({ jobId: result.jobId, title })
        setScraping(false)

        // Poll every 2s until done or failed
        pollRef.current = setInterval(async () => {
          try {
            const { job } = await tunnelApi.pollJob(result.jobId!)
            if (job.status === 'done') {
              stopPolling()
              setQueued(null)
              setSuccess(`"${job.result?.title ?? title}" ajouté — ${format === 'MP3' ? 'piste audio' : 'vidéo'} importée`)
              onScrapeSuccess?.()
              setTimeout(() => { setSuccess(''); setUrl(''); setPreview(null); inputRef.current?.focus() }, 4000)
            } else if (job.status === 'failed') {
              stopPolling()
              setQueued(null)
              setError(job.error ?? 'Le tunnel a échoué à télécharger cette vidéo.')
            }
          } catch { /* network hiccup, keep polling */ }
        }, 2000)
        return
      }

      const { track, video, alreadyExists } = result
      const name = track?.title ?? video?.title ?? preview?.title ?? trimmed
      setSuccess(alreadyExists
        ? `"${name}" est déjà dans la bibliothèque`
        : `"${name}" ajouté — ${format === 'MP3' ? 'piste audio' : 'vidéo'} importée`)
      onScrapeSuccess?.()
      setTimeout(() => {
        setSuccess('')
        setUrl('')
        setPreview(null)
        inputRef.current?.focus()
      }, 4000)
    } catch (e) {
      const raw = String(e).replace('Error: ', '')
      setError(
        raw.includes('Sign in') || raw.includes('bot')
          ? 'Cette vidéo n\'est pas accessible sans authentification YouTube (vidéo privée, age-restricted ou IP bloquée).'
          : raw.includes('unavailable') ? 'Vidéo non disponible (supprimée, privée ou géo-bloquée).'
          : raw.includes('timed out') ? 'Délai dépassé — réessaie dans quelques secondes.'
          : raw.split('\n')[0].slice(0, 200)
      )
    } finally {
      setScraping(false)
    }
  }

  const isShort = /youtube\.com\/shorts\//i.test(url)

  return (
    <div className="rounded-md overflow-hidden" style={{ border: `1px solid ${S.border}`, background: S.panel }}>

      {/* ── Header ── */}
      <div className="flex items-center gap-3 px-5 py-3.5 border-b" style={{ borderColor: S.border, background: S.panelAlt }}>
        <div className="flex items-center gap-2 px-2.5 py-1 rounded shrink-0"
          style={{ background: `${YT_ACCENT}12`, border: `1px solid ${YT_ACCENT}25` }}>
          <img src="/platform-icons/youtube.png" alt="YouTube" className="w-4 h-4 rounded object-contain" />
          <span className="text-xs font-semibold" style={{ color: YT_ACCENT }}>YouTube</span>
        </div>
        <div className="flex-1" />
        <div className="flex items-center gap-1 text-[10px]" style={{ color: S.textMute }}>
          <span style={{ color: isShort ? '#9b7ef8' : S.textFade }}>Shorts</span>
          <span style={{ color: S.textFade }}>/</span>
          <span>Vidéos</span>
        </div>
      </div>

      {/* ── Body ── */}
      <div className="flex flex-col gap-5 p-6">

        {/* URL input */}
        <div>
          <div className="text-[10px] uppercase tracking-wider mb-2" style={{ color: S.textMute }}>
            Lien YouTube
          </div>
          <div className="flex gap-2">
            <div className="flex-1 flex items-center gap-2 rounded px-3 py-2"
              style={{ background: S.input, border: `1px solid ${preview ? YT_ACCENT + '40' : error ? S.red + '40' : S.border}` }}>
              <Link2 size={13} style={{ color: S.textMute, flexShrink: 0 }} />
              <input
                ref={inputRef}
                type="text"
                value={url}
                onChange={e => handleUrlChange(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !loading && handleResolve()}
                placeholder="https://www.youtube.com/watch?v=… ou youtu.be/…"
                className="flex-1 bg-transparent text-xs outline-none"
                style={{ color: S.text }}
              />
              {url && (
                <button onClick={() => { setUrl(''); setPreview(null); setError(''); setSuccess('') }}
                  style={{ color: S.textFade }} className="hover:brightness-150 shrink-0">
                  <X size={11} />
                </button>
              )}
            </div>
            <button
              onClick={handleResolve}
              disabled={!url.trim() || loading}
              className="flex items-center gap-1.5 px-3 py-2 rounded text-xs font-semibold disabled:opacity-40"
              style={{ background: `${YT_ACCENT}18`, border: `1px solid ${YT_ACCENT}35`, color: YT_ACCENT }}>
              {loading ? <Loader2 size={12} className="animate-spin" /> : <PlayCircle size={12} />}
              Aperçu
            </button>
          </div>
          {error && (
            <p className="mt-1.5 text-[10px]" style={{ color: S.red }}>{error}</p>
          )}
        </div>

        {/* Preview card */}
        {preview && (
          <div className="rounded-md overflow-hidden flex gap-3"
            style={{ background: S.panelAlt, border: `1px solid ${S.border}` }}>
            {/* Thumbnail */}
            <div className="relative shrink-0" style={{ width: 100, height: 60 }}>
              {preview.artworkUrl
                ? <img src={preview.artworkUrl} alt="" className="w-full h-full object-cover" />
                : <div className="w-full h-full flex items-center justify-center" style={{ background: '#111' }}>
                    <Film size={20} style={{ color: S.textFade }} />
                  </div>
              }
              {preview.duration && (
                <span className="absolute bottom-1 right-1 text-[9px] font-mono px-1 rounded"
                  style={{ background: 'rgba(0,0,0,0.8)', color: '#eee' }}>
                  {fmtDuration(preview.duration)}
                </span>
              )}
            </div>
            {/* Info */}
            <div className="flex-1 py-2 pr-3 flex flex-col justify-center gap-1 min-w-0">
              <p className="text-xs font-semibold truncate leading-tight" style={{ color: S.text }}>
                {preview.title}
              </p>
              <div className="flex items-center gap-3 flex-wrap">
                <span className="text-[10px] truncate" style={{ color: S.textMute }}>{preview.artist}</span>
                {preview.duration && (
                  <span className="flex items-center gap-1 text-[10px] shrink-0" style={{ color: S.textFade }}>
                    <Clock size={9} />{fmtDuration(preview.duration)}
                  </span>
                )}
                {inLibrary && (
                  <span className="flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded"
                    style={{ background: S.green + '18', color: S.green, border: `1px solid ${S.green}30` }}>
                    <Check size={8} /> Déjà importé
                  </span>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Format selector */}
        <div>
          <div className="text-[10px] uppercase tracking-wider mb-2" style={{ color: S.textMute }}>
            Format de sortie
          </div>
          <div className="grid grid-cols-2 gap-2">
            {(['MP3', 'MP4'] as const).map(f => (
              <button
                key={f}
                onClick={() => setFormat(f)}
                className="flex items-center gap-2.5 px-3 py-2.5 rounded text-xs font-semibold"
                style={{
                  background: format === f ? `${S.accent}12` : S.input,
                  border: `1px solid ${format === f ? S.accent + '55' : S.border}`,
                  color: format === f ? S.accent : S.textDim,
                }}>
                <div className="flex items-center justify-center rounded"
                  style={{ width: 28, height: 28, background: format === f ? `${S.accent}15` : '#111', border: `1px solid ${format === f ? S.accent + '30' : S.border}` }}>
                  {f === 'MP3' ? <Music size={13} style={{ color: format === f ? S.accent : S.textMute }} /> : <Film size={13} style={{ color: format === f ? S.accent : S.textMute }} />}
                </div>
                <div className="text-left">
                  <div className="font-bold">{f}</div>
                  <div className="text-[9px] font-normal" style={{ color: format === f ? S.accent + 'aa' : S.textFade }}>
                    {f === 'MP3' ? 'Audio uniquement · Bibliothèque' : 'Vidéo HD · Galerie vidéo'}
                  </div>
                </div>
                {format === f && (
                  <Check size={11} className="ml-auto shrink-0" style={{ color: S.accent }} />
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Success */}
        {success && (
          <div className="flex items-center gap-2 px-3 py-2 rounded text-xs"
            style={{ background: `${S.green}10`, border: `1px solid ${S.green}30`, color: S.green }}>
            <Check size={12} />{success}
          </div>
        )}

        {/* Tunnel waiting */}
        {queued && (
          <div className="flex flex-col gap-1.5 px-3 py-2.5 rounded text-xs"
            style={{ background: `${YT_ACCENT}08`, border: `1px solid ${YT_ACCENT}25` }}>
            <div className="flex items-center gap-2" style={{ color: YT_ACCENT }}>
              <Wifi size={12} className="shrink-0" />
              <span className="font-medium">En attente du tunnel local…</span>
              <Loader2 size={11} className="animate-spin ml-auto" />
            </div>
            <p className="text-[10px]" style={{ color: S.textMute }}>
              Le tunnel télécharge <span className="font-medium" style={{ color: S.text }}>«&nbsp;{queued.title}&nbsp;»</span> sur ta machine
              avec tes cookies YouTube puis l'envoie ici.
            </p>
            <button
              onClick={() => { stopPolling(); setQueued(null) }}
              className="flex items-center gap-1 text-[10px] mt-0.5 w-fit"
              style={{ color: S.textFade }}>
              <X size={9} /> Annuler
            </button>
          </div>
        )}

        {/* Download button */}
        <button
          onClick={handleDownload}
          disabled={!url.trim() || scraping || !!success || !!queued}
          className="flex items-center justify-center gap-2 py-2.5 rounded text-sm font-semibold disabled:opacity-40"
          style={{ background: YT_ACCENT, color: '#fff' }}>
          {scraping
            ? <><Loader2 size={14} className="animate-spin" />Téléchargement…</>
            : <><Download size={14} />{format === 'MP3' ? 'Importer en MP3' : 'Importer en MP4'}</>
          }
        </button>

        {/* Help text */}
        <p className="text-center text-[10px]" style={{ color: S.textFade }}>
          Fonctionne avec les vidéos YouTube et les Shorts · MP3 → Bibliothèque · MP4 → Galerie vidéo
        </p>
      </div>
    </div>
  )
}
