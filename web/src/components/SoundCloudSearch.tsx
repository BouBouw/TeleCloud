import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { Search, Download, ExternalLink, Music2, Loader2, Play, Pause, Heart, Headphones, ArrowUpDown, CheckCircle2 } from 'lucide-react'
import { trackApi } from '../lib/api'
import type { SCResult, Track } from '../lib/api'
import { playerActions, usePlayerStore } from '../store/playerStore'
import { useI18n } from '../i18n'

const S = {
  panel:    '#1a1a1a',
  hover:    '#1e1e1e',
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

type SortKey = 'pertinence' | 'likes' | 'plays' | 'duration_asc' | 'duration_desc' | 'alpha' | 'date_desc' | 'date_asc'

function applySort(results: SCResult[], key: SortKey): SCResult[] {
  const r = [...results]
  switch (key) {
    case 'likes':         return r.sort((a, b) => (b.likesCount ?? 0) - (a.likesCount ?? 0))
    case 'plays':         return r.sort((a, b) => (b.playCount  ?? 0) - (a.playCount  ?? 0))
    case 'duration_asc':  return r.sort((a, b) => (a.duration   ?? 0) - (b.duration   ?? 0))
    case 'duration_desc': return r.sort((a, b) => (b.duration   ?? 0) - (a.duration   ?? 0))
    case 'alpha':         return r.sort((a, b) => a.title.localeCompare(b.title))
    case 'date_desc':     return r.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
    case 'date_asc':      return r.sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''))
    default:              return r
  }
}

function fmtNum(n?: number) {
  if (!n) return null
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

interface Props {
  workspaceId: string
  onScrapeSuccess?: () => void
  libraryTracks?: Track[]
}

export default function SoundCloudSearch({ workspaceId, onScrapeSuccess, libraryTracks }: Props) {
  const { t } = useI18n()
  const sorts = useMemo(() => [
    { key: 'pertinence'    as SortKey, label: t('sort_pertinence') },
    { key: 'likes'         as SortKey, label: t('sort_likes') },
    { key: 'plays'         as SortKey, label: t('sort_plays') },
    { key: 'duration_asc'  as SortKey, label: t('sort_short') },
    { key: 'duration_desc' as SortKey, label: t('sort_long') },
    { key: 'alpha'         as SortKey, label: t('sort_alpha') },
    { key: 'date_desc'     as SortKey, label: t('sort_recent') },
    { key: 'date_asc'      as SortKey, label: t('sort_oldest') },
  ], [t])
  const [input,       setInput]       = useState('')
  const [results,     setResults]     = useState<SCResult[]>([])
  const [loading,     setLoading]     = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [scraping,    setScraping]    = useState<string | null>(null)
  const [sort,        setSort]        = useState<SortKey>('pertinence')
  const [error,       setError]       = useState('')
  const [success,     setSuccess]     = useState('')
  const [nextOffset,  setNextOffset]  = useState<number | null>(null)
  const [currentQ,    setCurrentQ]    = useState('')

  const timerRef    = useRef<ReturnType<typeof setTimeout> | null>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)

  const { track: currentTrack, isPlaying } = usePlayerStore()

  const libraryUrls = useMemo(() =>
    new Set((libraryTracks ?? []).map(t => t.soundcloudUrl).filter(Boolean) as string[]),
    [libraryTracks]
  )

  const isSCUrl = (v: string) => /soundcloud\.com\//i.test(v)

  const doSearch = async (value: string) => {
    if (!value.trim()) { setResults([]); setNextOffset(null); setCurrentQ(''); return }
    setLoading(true); setError(''); setSort('pertinence')
    try {
      if (isSCUrl(value)) {
        const { result } = await trackApi.resolve(workspaceId, value.trim())
        setResults([result]); setNextOffset(null); setCurrentQ(value.trim())
      } else {
        const { results: r, nextOffset: next } = await trackApi.search(workspaceId, value.trim(), 0)
        setResults(r); setNextOffset(next); setCurrentQ(value.trim())
      }
    } catch (err) {
      setError(String(err).replace('Error: ', '')); setResults([])
    } finally {
      setLoading(false)
    }
  }

  const loadMore = useCallback(async () => {
    if (!currentQ || nextOffset === null || loadingMore || isSCUrl(currentQ)) return
    setLoadingMore(true)
    try {
      const { results: more, nextOffset: next } = await trackApi.search(workspaceId, currentQ, nextOffset)
      setResults(prev => [...prev, ...more]); setNextOffset(next)
    } catch {}
    finally { setLoadingMore(false) }
  }, [currentQ, nextOffset, loadingMore, workspaceId])

  const handleInput = (value: string) => {
    setInput(value)
    if (timerRef.current) clearTimeout(timerRef.current)
    const delay = isSCUrl(value) ? 0 : 500
    timerRef.current = setTimeout(() => doSearch(value), delay)
  }

  useEffect(() => {
    if (!sentinelRef.current) return
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) loadMore() },
      { threshold: 0.1 }
    )
    obs.observe(sentinelRef.current)
    return () => obs.disconnect()
  }, [loadMore])

  const togglePlay = (r: SCResult) => {
    if (!r.streamUrl) return
    if (currentTrack?.id === `sc-${r.id}`) {
      playerActions.togglePlay()
    } else {
      playerActions.setTrack({
        id: `sc-${r.id}`, title: r.title, artist: r.artist,
        artwork: r.artworkUrl, url: trackApi.previewUrl(workspaceId, r.streamUrl), type: 'preview',
      })
    }
  }

  const handleAdd = async (r: SCResult) => {
    setScraping(r.id); setError('')
    try {
      const { track, alreadyExists } = await trackApi.scrape(workspaceId, r.permalink_url)
      setSuccess(alreadyExists ? t('sc_already_in_lib', { title: track.title }) : t('sc_added_success', { title: track.title }))
      onScrapeSuccess?.()
    } catch (err) {
      setError(String(err).replace('Error: ', ''))
    } finally {
      setScraping(null)
      setTimeout(() => setSuccess(''), 3000)
    }
  }

  const displayed = sort === 'pertinence' ? results : applySort(results, sort)
  const fmt = (s?: number) => s ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '--:--'

  return (
    <div className="flex flex-col gap-3">

      {/* Search bar */}
      <div className="flex items-center gap-2.5 rounded-md px-3 py-2.5"
        style={{ background: S.input, border: `1px solid ${S.border}` }}>
        {loading
          ? <Loader2 size={14} className="animate-spin shrink-0" style={{ color: S.accent }} />
          : <Search  size={14} className="shrink-0" style={{ color: S.textMute }} />
        }
        <input
          type="text"
          value={input}
          onChange={e => handleInput(e.target.value)}
          placeholder={t('sc_search_placeholder')}
          className="flex-1 bg-transparent text-sm outline-none"
          style={{ color: S.text }}
        />
        {input && (
          <button
            onClick={() => { setInput(''); setResults([]); setNextOffset(null); setCurrentQ('') }}
            className="text-xs px-1 hover:brightness-150 transition-colors"
            style={{ color: S.textFade }}
          >x</button>
        )}
      </div>

      {/* Sort filters */}
      {results.length > 1 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <ArrowUpDown size={11} className="shrink-0" style={{ color: S.textFade }} />
          {sorts.map(s => (
            <button
              key={s.key}
              onClick={() => setSort(s.key)}
              className="px-2.5 py-0.5 rounded text-[11px] font-medium transition-all"
              style={{
                background: sort === s.key ? `${S.accent}18` : 'transparent',
                border: `1px solid ${sort === s.key ? S.accent + '55' : S.border}`,
                color: sort === s.key ? S.accent : S.textMute,
              }}
            >
              {s.label}
            </button>
          ))}
          <span className="ml-auto text-[10px] tabular-nums" style={{ color: S.textFade }}>{t('results_count', { N: String(results.length) })}</span>
        </div>
      )}

      {error   && <p className="text-xs px-1" style={{ color: S.red }}>{error}</p>}
      {success && <p className="text-xs px-1" style={{ color: S.green }}>{success}</p>}

      {/* Results */}
      {displayed.length > 0 && (
        <div className="flex flex-col">
          {displayed.map(r => {
            const isActive      = currentTrack?.id === `sc-${r.id}`
            const isThisPlaying = isActive && isPlaying
            const inLibrary     = libraryUrls.has(r.permalink_url)
            return (
              <div
                key={r.id}
                className="flex items-center gap-3 px-3 py-2 group transition-colors"
                style={{
                  borderBottom: `1px solid ${S.border}`,
                  background: inLibrary
                    ? 'rgba(46,184,114,0.06)'
                    : isActive
                    ? `${S.accent}07`
                    : undefined,
                }}
                onMouseEnter={e => { if (!inLibrary && !isActive) (e.currentTarget as HTMLElement).style.background = S.hover }}
                onMouseLeave={e => { if (!inLibrary && !isActive) (e.currentTarget as HTMLElement).style.background = '' }}
              >
                {/* Artwork */}
                <div
                  className="relative w-9 h-9 rounded overflow-hidden shrink-0 cursor-pointer"
                  style={{ background: S.input, border: `1px solid ${S.border}` }}
                  onClick={() => togglePlay(r)}
                >
                  {r.artworkUrl
                    ? <img src={r.artworkUrl} alt="" className="w-full h-full object-cover" />
                    : <div className="w-full h-full flex items-center justify-center"><Music2 size={13} style={{ color: S.textFade }} /></div>
                  }
                  {r.streamUrl && (
                    <div className="absolute inset-0 flex items-center justify-center transition-opacity"
                      style={{ background: 'rgba(0,0,0,0.55)', opacity: isActive ? 1 : 0 }}
                      onMouseEnter={e => (e.currentTarget as HTMLElement).style.opacity = '1'}
                      onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLElement).style.opacity = '0' }}
                    >
                      {isThisPlaying
                        ? <Pause size={11} style={{ color: '#fff' }} />
                        : <Play  size={11} style={{ color: '#fff', transform: 'translateX(1px)' }} />
                      }
                    </div>
                  )}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium truncate" style={{ color: isActive ? S.accent : S.text }}>{r.title}</p>
                  <div className="flex items-center gap-1.5 mt-0.5 text-[10px]" style={{ color: S.textMute }}>
                    <span className="truncate">{r.artist}</span>
                    <span style={{ color: S.textFade }}>·</span>
                    <span className="shrink-0 tabular-nums font-mono">{fmt(r.duration)}</span>
                    {fmtNum(r.likesCount) && (
                      <>
                        <span style={{ color: S.textFade }}>·</span>
                        <span className="flex items-center gap-0.5 shrink-0">
                          <Heart size={9} style={{ color: '#e75480' }} />{fmtNum(r.likesCount)}
                        </span>
                      </>
                    )}
                    {fmtNum(r.playCount) && (
                      <>
                        <span style={{ color: S.textFade }}>·</span>
                        <span className="flex items-center gap-0.5 shrink-0">
                          <Headphones size={9} style={{ color: '#5b9bd5' }} />{fmtNum(r.playCount)}
                        </span>
                      </>
                    )}
                  </div>
                </div>

                {/* External link */}
                <a
                  href={r.permalink_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="opacity-0 group-hover:opacity-100 transition-opacity p-1"
                  style={{ color: S.textFade }}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = S.textDim}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = S.textFade}
                >
                  <ExternalLink size={11} />
                </a>

                {/* Add / In library */}
                {inLibrary ? (
                  <span className="flex items-center gap-1 px-2 py-1 rounded text-[10px] shrink-0"
                    style={{ background: 'rgba(46,184,114,0.1)', color: S.green, border: `1px solid rgba(46,184,114,0.2)` }}>
                    <CheckCircle2 size={10} />{t('in_library_badge')}
                  </span>
                ) : (
                  <button
                    onClick={() => handleAdd(r)}
                    disabled={scraping === r.id}
                    className="opacity-0 group-hover:opacity-100 flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-semibold transition-all disabled:opacity-50 shrink-0"
                    style={{ background: `${S.accent}18`, color: S.accent, border: `1px solid ${S.accent}40` }}
                  >
                    {scraping === r.id ? <Loader2 size={11} className="animate-spin" /> : <Download size={11} />}
                    {t('btn_add')}
                  </button>
                )}
              </div>
            )
          })}

          {/* Sentinel / load more */}
          <div ref={sentinelRef} className="flex items-center justify-center py-4">
            {loadingMore ? (
              <span className="flex items-center gap-2 text-xs" style={{ color: S.textMute }}>
                <Loader2 size={13} className="animate-spin" style={{ color: S.accent }} />{t('loading')}
              </span>
            ) : nextOffset !== null ? (
              <button
                onClick={loadMore}
                className="flex items-center gap-2 px-4 py-1.5 rounded text-xs transition-all hover:brightness-125"
                style={{ border: `1px solid ${S.border}`, color: S.textMute }}
              >
                {t('sc_load_more')}
              </button>
            ) : null}
          </div>
        </div>
      )}

      {!loading && !error && input.trim() && results.length === 0 && (
        <div className="flex flex-col items-center py-12 gap-2" style={{ color: S.textMute }}>
          <Music2 size={24} style={{ opacity: 0.3 }} />
          <p className="text-xs">{t('search_no_results')} &quot;{input}&quot;</p>
        </div>
      )}

      {!input && (
        <div className="flex flex-col items-center py-12 gap-2" style={{ color: S.textMute }}>
          <Search size={24} style={{ opacity: 0.2 }} />
          <p className="text-xs">{t('sc_search_placeholder')}</p>
        </div>
      )}
    </div>
  )
}
