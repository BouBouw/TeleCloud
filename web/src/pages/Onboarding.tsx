import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { wsApi, botApi, trackApi } from '../lib/api'
import type { Workspace, SCResult } from '../lib/api'
import { workspaceActions } from '../store/workspaceStore'
import {
  Volume2, Bot, Music2, CheckCircle2, ArrowRight, Loader2,
  Search, Radio, Zap, X, ChevronRight, Sparkles, Play, Pause,
} from 'lucide-react'

/* ─── Design tokens ─── */
const S = {
  bg:       '#111',
  panel:    '#1a1a1a',
  panelAlt: '#161616',
  border:   '#2a2a2a',
  borderHi: '#3a3a3a',
  accent:   '#f0a830',
  text:     '#ccc',
  textDim:  '#888',
  textMute: '#555',
  textFade: '#333',
  input:    '#0a0a0a',
  red:      '#e74c3c',
  green:    '#4ade80',
  yellow:   '#facc15',
}

/* ─── Helpers ─── */
function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'my-workspace'
}
function markOnboarded() { localStorage.setItem('ss_onboarded', 'true') }
function fmtDuration(s?: number) {
  if (!s) return ''
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/* ─── Step types ─── */
type Step = 'welcome' | 'workspace' | 'bot' | 'track' | 'done'
const STEPS: Step[] = ['welcome', 'workspace', 'bot', 'track', 'done']
const IDX: Record<Step, number> = { welcome: 0, workspace: 1, bot: 2, track: 3, done: 4 }

/* ─── Progress stepper ─── */
function Stepper({ step }: { step: Step }) {
  const active = Math.max(0, IDX[step] - 1)
  const labels = ['Workspace', 'Bot', 'Track']
  if (step === 'welcome' || step === 'done') return null
  return (
    <div className="flex items-center justify-center gap-2 mb-7">
      {labels.map((label, i) => {
        const done    = i < active
        const current = i === active
        return (
          <div key={label} className="flex items-center gap-2">
            <div className="flex items-center gap-1.5">
              <div
                className="flex items-center justify-center text-[10px] font-bold rounded-full"
                style={{
                  width: 22, height: 22,
                  background: done ? S.accent : current ? S.panelAlt : S.input,
                  border: `1.5px solid ${done || current ? S.accent : S.border}`,
                  color: done ? '#000' : current ? S.accent : S.textFade,
                }}
              >
                {done ? '✓' : i + 1}
              </div>
              <span
                className="text-[11px] font-medium hidden sm:block"
                style={{ color: done || current ? S.text : S.textFade }}
              >
                {label}
              </span>
            </div>
            {i < labels.length - 1 && (
              <div
                className="w-8 h-px"
                style={{ background: i < active ? S.accent : S.border }}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}

/* ─── Shared card wrapper ─── */
function Card({ children, onSkipAll, step }: { children: React.ReactNode; onSkipAll: () => void; step: Step }) {
  return (
    <div className="relative w-full max-w-lg fade-in">
      {step !== 'done' && (
        <button
          onClick={onSkipAll}
          className="absolute -top-9 right-0 flex items-center gap-1 text-[11px] hover:brightness-125"
          style={{ color: S.textMute, background: 'transparent', border: 'none', cursor: 'pointer' }}
        >
          <X size={11} />Passer la config
        </button>
      )}
      {children}
    </div>
  )
}

const cardSty: React.CSSProperties = {
  background: S.panel, border: `1px solid ${S.borderHi}`, borderRadius: 10, padding: 28,
}
const inputCls = "w-full outline-none rounded-md px-3 py-2.5 text-sm"
const inputSty: React.CSSProperties = { background: S.input, color: S.text, border: `1px solid ${S.border}` }
const btnPrimary: React.CSSProperties = { background: S.accent, color: '#000', border: 'none', cursor: 'pointer' }
const btnSecondary: React.CSSProperties = { background: S.input, color: S.textMute, border: `1px solid ${S.border}`, cursor: 'pointer' }

/* ─── Page background ─── */
const BG_STYLE: React.CSSProperties = {
  background: `radial-gradient(ellipse at 50% 20%, rgba(240,168,48,0.07) 0%, ${S.bg} 65%)`,
}

/* ─── Logo header ─── */
function LogoHeader() {
  return (
    <div className="flex items-center justify-center gap-3 mb-8">
      <div
        className="flex items-center justify-center rounded"
        style={{ width: 38, height: 38, background: S.panelAlt, border: `1px solid ${S.border}` }}
      >
        <Volume2 size={16} style={{ color: S.accent }} />
      </div>
      <span className="text-xl font-bold tracking-tight" style={{ color: S.text }}>
        Sound<span style={{ color: S.accent }}>Sync</span>
      </span>
    </div>
  )
}

/* ─── Error box ─── */
function ErrBox({ msg }: { msg: string }) {
  return (
    <div className="mb-4 px-3 py-2.5 rounded text-xs" style={{ background: 'rgba(231,76,60,0.1)', border: `1px solid rgba(231,76,60,0.25)`, color: S.red }}>
      {msg}
    </div>
  )
}

/* ─── Onboarding ─── */
export default function Onboarding() {
  const navigate   = useNavigate()
  const { user }   = useAuth()
  const [step, setStep] = useState<Step>('welcome')

  // workspace
  const [ws, setWs]                 = useState<Workspace | null>(null)
  const [wsName, setWsName]         = useState('')
  const [wsLoading, setWsLoading]   = useState(false)
  const [wsError, setWsError]       = useState('')

  // bot
  const [botName, setBotName]         = useState('')
  const [botToken, setBotToken]       = useState('')
  const [botChannel, setBotChannel]   = useState('')
  const [botLoading, setBotLoading]   = useState(false)
  const [botError, setBotError]       = useState('')

  // track
  const [searchQ, setSearchQ]                 = useState('')
  const [results, setResults]                 = useState<SCResult[]>([])
  const [searchLoading, setSearchLoading]     = useState(false)
  const [importingId, setImportingId]         = useState<string | null>(null)
  const [importedTrack, setImportedTrack]     = useState(false)
  const [playingId, setPlayingId]             = useState<string | null>(null)
  const [previewProgress, setPreviewProgress] = useState(0)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  useEffect(() => {
    return () => { audioRef.current?.pause(); audioRef.current = null }
  }, [])

  const stopPreview = () => {
    audioRef.current?.pause(); audioRef.current = null
    setPlayingId(null); setPreviewProgress(0)
  }

  const togglePreview = (r: SCResult) => {
    if (!r.streamUrl) return
    if (playingId === r.id) { stopPreview(); return }
    stopPreview()
    if (!ws) return
    const audio = new Audio(trackApi.previewUrl(ws.id, r.streamUrl))
    audio.addEventListener('timeupdate', () => {
      if (audio.duration) setPreviewProgress(audio.currentTime / audio.duration)
    })
    audio.addEventListener('ended', () => { setPlayingId(null); setPreviewProgress(0) })
    audio.addEventListener('error',  () => { setPlayingId(null); setPreviewProgress(0) })
    audio.play().catch(() => setPlayingId(null))
    audioRef.current = audio
    setPlayingId(r.id); setPreviewProgress(0)
  }

  const goNext  = () => setStep(prev => STEPS[Math.min(IDX[prev] + 1, STEPS.length - 1)])
  const finish  = () => {
    markOnboarded()
    // If a workspace was created, invalidate the store so AppLayout re-fetches and finds it
    if (ws) { workspaceActions.invalidate(); workspaceActions.init() }
    navigate('/dashboard')
  }
  const skipAll = () => { markOnboarded(); navigate('/dashboard') }

  const handleWorkspace = async (e: React.FormEvent) => {
    e.preventDefault(); setWsLoading(true); setWsError('')
    try {
      const data = await wsApi.create(wsName.trim(), slugify(wsName))
      setWs(data.workspace); goNext()
    } catch (err) { setWsError(String(err).replace('Error: ', '')) }
    finally { setWsLoading(false) }
  }

  const handleBot = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!ws) { goNext(); return }
    setBotLoading(true); setBotError('')
    try {
      await botApi.create(ws.id, { name: botName, telegramToken: botToken, channelId: botChannel })
      goNext()
    } catch (err) { setBotError(String(err).replace('Error: ', '')) }
    finally { setBotLoading(false) }
  }

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!ws || !searchQ.trim()) return
    setSearchLoading(true); setResults([]); stopPreview()
    try {
      const data = await trackApi.search(ws.id, searchQ.trim())
      setResults(data.results)
    } catch { setResults([]) }
    finally { setSearchLoading(false) }
  }

  const handleImport = async (r: SCResult) => {
    if (!ws) return
    setImportingId(r.id)
    try {
      await trackApi.scrape(ws.id, r.permalink_url)
      setImportedTrack(true); setTimeout(goNext, 1000)
    } catch { /* ignore */ }
    finally { setImportingId(null) }
  }

  /* ── WELCOME ── */
  if (step === 'welcome') {
    return (
      <div className="min-h-screen flex items-center justify-center p-4" style={BG_STYLE}>
        <Card onSkipAll={skipAll} step={step}>
          <LogoHeader />
          <div style={cardSty} className="text-center">
            <div
              className="flex items-center justify-center rounded mx-auto mb-5"
              style={{ width: 56, height: 56, background: S.panelAlt, border: `1px solid ${S.border}` }}
            >
              <Sparkles size={24} style={{ color: S.accent }} />
            </div>
            <h1 className="text-xl font-bold mb-2" style={{ color: S.text }}>
              Bienvenue, {user?.displayName?.split(' ')[0] ?? 'toi'} !
            </h1>
            <p className="text-sm mb-8 leading-relaxed" style={{ color: S.textMute }}>
              Configure ton workspace en 3 étapes — déploie un bot Telegram, connecte un channel et ajoute ta première piste.
            </p>

            <div className="grid grid-cols-3 gap-3 mb-7">
              {[
                { icon: Zap,    label: 'Workspace',    desc: 'Ton espace personnel' },
                { icon: Bot,    label: 'Bot Telegram', desc: 'Connecte un channel'  },
                { icon: Music2, label: 'Première piste', desc: 'Via SoundCloud'     },
              ].map(({ icon: Icon, label, desc }) => (
                <div
                  key={label}
                  className="p-3 rounded text-center"
                  style={{ background: S.panelAlt, border: `1px solid ${S.border}` }}
                >
                  <Icon size={16} style={{ color: S.accent, margin: '0 auto 6px' }} />
                  <p className="text-[11px] font-semibold" style={{ color: S.text }}>{label}</p>
                  <p className="text-[10px] mt-0.5" style={{ color: S.textFade }}>{desc}</p>
                </div>
              ))}
            </div>

            <button
              onClick={goNext}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-md text-sm font-semibold hover:opacity-85 transition-opacity"
              style={btnPrimary}
            >
              Configurer mon workspace <ArrowRight size={15} />
            </button>
            <button
              onClick={skipAll}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-md text-sm hover:opacity-90 transition-opacity mt-2"
              style={{ ...btnSecondary, borderColor: S.borderHi }}
            >
              Je rejoins un workspace partagé
            </button>
            <p className="mt-3 text-[10px] leading-relaxed" style={{ color: S.textFade }}>
              Si quelqu'un t'invite à son espace, choisis cette option — tu n'as rien à configurer.
            </p>
          </div>
        </Card>
      </div>
    )
  }

  /* ── WORKSPACE ── */
  if (step === 'workspace') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4" style={BG_STYLE}>
        <Card onSkipAll={skipAll} step={step}>
          <Stepper step={step} />
          <div style={cardSty}>
            <div className="flex items-center gap-3 mb-5">
              <div className="flex items-center justify-center rounded shrink-0"
                style={{ width: 36, height: 36, background: S.panelAlt, border: `1px solid ${S.border}` }}>
                <Zap size={16} style={{ color: S.accent }} />
              </div>
              <div>
                <h2 className="text-sm font-semibold" style={{ color: S.text }}>Créer ton workspace</h2>
                <p className="text-[11px]" style={{ color: S.textMute }}>Ton espace pour gérer bots et pistes</p>
              </div>
            </div>

            {wsError && <ErrBox msg={wsError} />}

            <form onSubmit={handleWorkspace} className="flex flex-col gap-4">
              <div>
                <div className="text-[10px] uppercase tracking-wide mb-1.5" style={{ color: S.textMute }}>Nom du workspace</div>
                <input
                  required autoFocus
                  value={wsName}
                  onChange={e => setWsName(e.target.value)}
                  placeholder="ex. My Music Channel"
                  className={inputCls}
                  style={inputSty}
                  onFocus={e => (e.target.style.borderColor = S.borderHi)}
                  onBlur={e => (e.target.style.borderColor = S.border)}
                />
                {wsName && (
                  <p className="mt-1.5 text-[10px] font-mono" style={{ color: S.textFade }}>
                    slug: <span style={{ color: S.accent }}>{slugify(wsName)}</span>
                  </p>
                )}
              </div>
              <div className="flex gap-2 pt-1">
                <button type="button" onClick={goNext} className="flex-1 py-2.5 rounded-md text-sm"
                  style={btnSecondary}>Passer</button>
                <button type="submit" disabled={wsLoading}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-md text-sm font-semibold disabled:opacity-60"
                  style={btnPrimary}>
                  {wsLoading ? <Loader2 size={14} className="animate-spin" /> : <><ChevronRight size={14} />Créer</>}
                </button>
              </div>
            </form>
          </div>
        </Card>
      </div>
    )
  }

  /* ── BOT ── */
  if (step === 'bot') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4" style={BG_STYLE}>
        <Card onSkipAll={skipAll} step={step}>
          <Stepper step={step} />
          <div style={cardSty}>
            <div className="flex items-center gap-3 mb-5">
              <div className="flex items-center justify-center rounded shrink-0"
                style={{ width: 36, height: 36, background: S.panelAlt, border: `1px solid ${S.border}` }}>
                <Bot size={16} style={{ color: S.accent }} />
              </div>
              <div>
                <h2 className="text-sm font-semibold" style={{ color: S.text }}>Déployer ton premier bot</h2>
                <p className="text-[11px]" style={{ color: S.textMute }}>
                  {ws ? `Workspace : ${ws.name}` : 'Connecte un bot Telegram à un channel'}
                </p>
              </div>
            </div>

            {!ws && (
              <div className="mb-4 px-3 py-2.5 rounded text-xs"
                style={{ background: 'rgba(250,204,21,0.08)', border: `1px solid rgba(250,204,21,0.2)`, color: S.yellow }}>
                Aucun workspace créé — le bot sera ignoré. Tu peux en déployer un depuis la page Channels.
              </div>
            )}
            {botError && <ErrBox msg={botError} />}

            <form onSubmit={handleBot} className="flex flex-col gap-4">
              {[
                { label: 'Nom du bot', val: botName, set: setBotName, placeholder: 'MusicBot Alpha', type: 'text' },
                { label: 'Token (@BotFather)', val: botToken, set: setBotToken, placeholder: '1234567890:ABCdef…', type: 'password' },
                { label: 'Channel ID', val: botChannel, set: setBotChannel, placeholder: '-1001234567890 ou @username', type: 'text' },
              ].map(({ label, val, set, placeholder, type }) => (
                <div key={label}>
                  <div className="text-[10px] uppercase tracking-wide mb-1.5" style={{ color: S.textMute }}>{label}</div>
                  <input
                    required={!!ws} disabled={!ws} type={type}
                    value={val} onChange={e => set(e.target.value)}
                    placeholder={placeholder}
                    className={inputCls}
                    style={{ ...inputSty, fontFamily: type === 'password' || label.includes('Channel') || label.includes('Token') ? 'monospace' : 'inherit', opacity: !ws ? 0.4 : 1 }}
                    onFocus={e => (e.target.style.borderColor = S.borderHi)}
                    onBlur={e => (e.target.style.borderColor = S.border)}
                  />
                </div>
              ))}
              <div className="flex items-center gap-2 px-3 py-2 rounded text-[11px]"
                style={{ background: S.panelAlt, border: `1px solid ${S.border}` }}>
                <Radio size={11} style={{ color: S.accent, flexShrink: 0 }} />
                <span style={{ color: S.textMute }}>Un conteneur Docker sera démarré pour ce bot.</span>
              </div>
              <div className="flex gap-2 pt-1">
                <button type="button" onClick={goNext} className="flex-1 py-2.5 rounded-md text-sm"
                  style={btnSecondary}>Passer</button>
                <button type="submit" disabled={botLoading || !ws}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-md text-sm font-semibold disabled:opacity-60"
                  style={btnPrimary}>
                  {botLoading ? <Loader2 size={14} className="animate-spin" /> : <><Bot size={14} />Déployer</>}
                </button>
              </div>
            </form>
          </div>
        </Card>
      </div>
    )
  }

  /* ── TRACK ── */
  if (step === 'track') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4" style={BG_STYLE}>
        <Card onSkipAll={skipAll} step={step}>
          <Stepper step={step} />
          <div style={cardSty}>
            <div className="flex items-center gap-3 mb-5">
              <div className="flex items-center justify-center rounded shrink-0"
                style={{ width: 36, height: 36, background: S.panelAlt, border: `1px solid ${S.border}` }}>
                <Music2 size={16} style={{ color: S.accent }} />
              </div>
              <div>
                <h2 className="text-sm font-semibold" style={{ color: S.text }}>Ajouter ta première piste</h2>
                <p className="text-[11px]" style={{ color: S.textMute }}>Recherche sur SoundCloud et importe une chanson</p>
              </div>
            </div>

            {!ws && (
              <div className="mb-4 px-3 py-2.5 rounded text-xs"
                style={{ background: 'rgba(250,204,21,0.08)', border: `1px solid rgba(250,204,21,0.2)`, color: S.yellow }}>
                Aucun workspace — tu peux ajouter des pistes depuis la Library plus tard.
              </div>
            )}

            {importedTrack ? (
              <div className="flex flex-col items-center py-10 gap-3">
                <CheckCircle2 size={38} style={{ color: S.green }} />
                <p className="text-sm font-medium" style={{ color: S.text }}>Piste importée !</p>
                <p className="text-[11px]" style={{ color: S.textMute }}>Passage à l'étape suivante…</p>
              </div>
            ) : (
              <>
                {/* Search form */}
                <form onSubmit={handleSearch} className="flex gap-2 mb-4">
                  <div
                    className="flex-1 flex items-center gap-2 rounded-md px-3 py-2"
                    style={{ background: S.input, border: `1px solid ${S.border}` }}
                  >
                    <Search size={13} style={{ color: S.textMute, flexShrink: 0 }} />
                    <input
                      value={searchQ}
                      onChange={e => setSearchQ(e.target.value)}
                      placeholder="Rechercher sur SoundCloud…"
                      disabled={!ws}
                      className="flex-1 bg-transparent text-xs outline-none"
                      style={{ color: S.text, opacity: !ws ? 0.4 : 1 }}
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={searchLoading || !ws || !searchQ.trim()}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-md text-xs font-semibold disabled:opacity-50"
                    style={btnPrimary}
                  >
                    {searchLoading ? <Loader2 size={13} className="animate-spin" /> : 'Chercher'}
                  </button>
                </form>

                {/* Results */}
                <div className="flex flex-col gap-1 max-h-64 overflow-y-auto">
                  {results.map(r => (
                    <div key={r.id} style={{ background: S.panelAlt, border: `1px solid ${S.border}`, borderRadius: 6 }}>
                      <div className="flex items-center gap-3 px-3 py-2.5">
                        {/* Preview */}
                        <button
                          onClick={() => togglePreview(r)}
                          disabled={!r.streamUrl}
                          className="shrink-0 flex items-center justify-center rounded-full"
                          style={{
                            width: 24, height: 24,
                            background: playingId === r.id ? S.accent : S.input,
                            border: `1px solid ${playingId === r.id ? S.accent : S.border}`,
                            color: playingId === r.id ? '#000' : S.textMute,
                            cursor: r.streamUrl ? 'pointer' : 'default',
                            opacity: !r.streamUrl ? 0.3 : 1,
                          }}
                        >
                          {playingId === r.id ? <Pause size={10} /> : <Play size={10} />}
                        </button>
                        {/* Artwork */}
                        {r.artworkUrl
                          ? <img src={r.artworkUrl} alt="" className="w-9 h-9 rounded object-cover shrink-0"
                              style={{ border: `1px solid ${S.border}` }} />
                          : <div className="w-9 h-9 rounded flex items-center justify-center shrink-0"
                              style={{ background: S.input, border: `1px solid ${S.border}` }}>
                              <Music2 size={13} style={{ color: S.textFade }} />
                            </div>
                        }
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium truncate" style={{ color: S.text }}>{r.title}</p>
                          <p className="text-[10px] truncate" style={{ color: S.textMute }}>
                            {r.artist}{r.duration ? ` · ${fmtDuration(r.duration)}` : ''}
                          </p>
                        </div>
                        <button
                          onClick={() => handleImport(r)}
                          disabled={importingId === r.id}
                          className="flex items-center gap-1 px-3 py-1.5 rounded text-[11px] font-semibold disabled:opacity-60 shrink-0"
                          style={btnPrimary}
                        >
                          {importingId === r.id ? <Loader2 size={11} className="animate-spin" /> : 'Importer'}
                        </button>
                      </div>
                      {playingId === r.id && (
                        <div className="px-3 pb-2 -mt-1">
                          <div className="h-0.5 rounded-full overflow-hidden" style={{ background: S.border }}>
                            <div
                              className="h-full transition-[width] duration-300"
                              style={{ width: `${previewProgress * 100}%`, background: S.accent }}
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                  {results.length === 0 && !searchLoading && searchQ && (
                    <p className="text-center text-[11px] py-6" style={{ color: S.textFade }}>Aucun résultat. Essaie un autre terme.</p>
                  )}
                  {results.length === 0 && !searchLoading && !searchQ && (
                    <p className="text-center text-[11px] py-6" style={{ color: S.textFade }}>Tape quelque chose pour rechercher.</p>
                  )}
                </div>
              </>
            )}

            <div className="flex gap-2 mt-5">
              <button type="button" onClick={goNext} className="flex-1 py-2.5 rounded-md text-sm"
                style={btnSecondary}>Passer</button>
            </div>
          </div>
        </Card>
      </div>
    )
  }

  /* ── DONE ── */
  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={BG_STYLE}>
      <div className="w-full max-w-md fade-in text-center">
        <LogoHeader />
        <div style={cardSty}>
          <div
            className="flex items-center justify-center rounded mx-auto mb-5"
            style={{ width: 64, height: 64, background: S.panelAlt, border: `1px solid ${S.border}` }}
          >
            <CheckCircle2 size={32} style={{ color: S.green }} />
          </div>
          <h1 className="text-xl font-bold mb-2" style={{ color: S.text }}>C'est parti !</h1>
          <p className="text-sm mb-7 leading-relaxed" style={{ color: S.textMute }}>
            Ton workspace est prêt. Rendez-vous sur le dashboard pour commencer à diffuser ta musique sur Telegram.
          </p>

          <div className="grid grid-cols-3 gap-3 mb-7">
            {[
              { icon: Zap,    label: ws ? ws.name    : 'Workspace', sub: ws ? 'Créé'     : 'Passé'     },
              { icon: Bot,    label: botName || 'Bot',              sub: botName ? 'Déployé' : 'Passé' },
              { icon: Music2, label: 'Piste',                       sub: importedTrack ? 'Importée' : 'Passée' },
            ].map(({ icon: Icon, label, sub }) => {
              const done = sub !== 'Passé' && sub !== 'Passée'
              return (
                <div key={label} className="p-3 rounded text-center"
                  style={{ background: S.panelAlt, border: `1px solid ${S.border}` }}>
                  <Icon size={15} style={{ color: done ? S.accent : S.textFade, margin: '0 auto 6px' }} />
                  <p className="text-[11px] font-medium truncate" style={{ color: S.text }}>{label}</p>
                  <p className="text-[10px]" style={{ color: done ? S.green : S.textFade }}>{sub}</p>
                </div>
              )
            })}
          </div>

          <button
            onClick={finish}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-md text-sm font-semibold hover:opacity-85 transition-opacity"
            style={btnPrimary}
          >
            Aller au Dashboard <ArrowRight size={15} />
          </button>
        </div>
      </div>
    </div>
  )
}
