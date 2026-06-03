import { useState, useRef, useMemo, Fragment } from 'react'
import {
  ChevronRight, Check,
  Link2, AtSign, Music, Film, Loader2,
  CheckCircle2, Clock, Download,
} from 'lucide-react'
import { trackApi } from '../lib/api'
import type { SocialResult, Track } from '../lib/api'
import { useI18n } from '../i18n'

const S = {
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
  green:    '#2eb872',
}

type SocialPlatform = 'tiktok' | 'instagram' | 'x' | 'snapchat'
type InputMode      = 'url' | 'username'
type OutputFormat   = 'MP3' | 'MP4'
type WizardStep     = 1 | 2 | 3 | 4

interface WizardForm {
  inputMode    : InputMode
  input        : string
  contentTypes : string[]
  outputFormat : OutputFormat
}

const DEFAULT_FORM: WizardForm = {
  inputMode   : 'url',
  input       : '',
  contentTypes: [],
  outputFormat: 'MP3',
}

const PLATFORM_LABELS: Record<SocialPlatform, string> = {
  tiktok:    'TikTok',
  instagram: 'Instagram',
  x:         'X',
  snapchat:  'Snapchat',
}

const PLATFORM_ACCENT: Record<SocialPlatform, string> = {
  tiktok:    '#69C9D0',
  instagram: '#E4405F',
  x:         '#e7e9ea',
  snapchat:  '#FFFC00',
}

const URL_EXAMPLES: Record<SocialPlatform, string> = {
  tiktok:    'https://www.tiktok.com/@user/video/...',
  instagram: 'https://www.instagram.com/p/...',
  x:         'https://x.com/user/status/...',
  snapchat:  'https://story.snapchat.com/s/username',
}

type ContentTypeOption = { id: string; label: string; desc: string }

function fmtDuration(s?: number) {
  if (!s) return undefined
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
}

function buildUsernameUrl(platform: SocialPlatform, username: string): string {
  const u = username.replace(/^@/, '')
  switch (platform) {
    case 'tiktok':    return `https://www.tiktok.com/@${u}`
    case 'instagram': return `https://www.instagram.com/${u}/`
    case 'x':         return `https://x.com/${u}`
    case 'snapchat':  return `https://story.snapchat.com/s/${u}`
  }
}

/* ── Inline platform mini-icons ── */
function PlatformIcon({ platform, size = 20 }: { platform: SocialPlatform; size?: number }) {
  return (
    <img
      src={`/platform-icons/${platform}.png`}
      alt={platform}
      width={size}
      height={size}
      className="shrink-0 rounded object-contain"
    />
  )
}

interface Props {
  workspaceId     : string
  platform        : SocialPlatform
  onScrapeSuccess?: (format: OutputFormat) => void
  libraryTracks?  : Track[]
}

export default function SocialSearch({ workspaceId, platform, onScrapeSuccess, libraryTracks }: Props) {
  const { t } = useI18n()
  const CONTENT_TYPES: Record<SocialPlatform, ContentTypeOption[]> = useMemo(() => ({
    tiktok: [
      { id: 'videos',  label: 'Videos',  desc: t('ct_tiktok_videos_desc') },
      { id: 'stories', label: 'Stories', desc: t('ct_tiktok_stories_desc') },
    ],
    instagram: [
      { id: 'posts',   label: 'Posts',   desc: t('ct_instagram_posts_desc') },
      { id: 'reels',   label: 'Reels',   desc: t('ct_instagram_reels_desc') },
      { id: 'stories', label: 'Stories', desc: t('ct_instagram_stories_desc') },
    ],
    x: [
      { id: 'videos', label: 'Videos', desc: t('ct_x_videos_desc') },
      { id: 'posts',  label: 'Posts',  desc: t('ct_x_posts_desc') },
    ],
    snapchat: [
      { id: 'stories',    label: 'Stories',    desc: t('ct_snapchat_stories_desc') },
      { id: 'highlights', label: 'Highlights', desc: t('ct_snapchat_highlights_desc') },
    ],
  }), [t])
  const [step,     setStep]     = useState<WizardStep>(1)
  const [form,     setForm]     = useState<WizardForm>(DEFAULT_FORM)
  const [preview,  setPreview]  = useState<SocialResult | null>(null)
  const [loading,  setLoading]  = useState(false)
  const [scraping, setScraping] = useState(false)
  const [error,    setError]    = useState('')
  const [success,  setSuccess]  = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const accent = PLATFORM_ACCENT[platform]
  const isUrl  = form.inputMode === 'url'

  const stepLabels = isUrl
    ? [t('step_label_mode'), t('step_label_target'), t('step_label_format')]
    : [t('step_label_mode'), t('step_label_target'), t('step_label_content'), t('step_label_format')]

  const displayStep = (step === 4 && isUrl) ? 3 : (step as number)
  const contentOpts = CONTENT_TYPES[platform]
  const allSelected = contentOpts.every(ct => form.contentTypes.includes(ct.id))

  const inLibrary = useMemo(() => {
    if (!preview) return false
    return (libraryTracks ?? []).some(tr => tr.soundcloudUrl === preview.permalink_url)
  }, [preview, libraryTracks])

  const goNext = async () => {
    if (step === 2) {
      if (!form.input.trim()) return
      if (isUrl) {
        setLoading(true); setError(''); setPreview(null)
        try {
          const { result } = await trackApi.resolveSocial(workspaceId, form.input.trim())
          setPreview(result); setStep(4)
        } catch (e) { setError(String(e).replace('Error: ', '')) }
        finally { setLoading(false) }
        return
      }
      if (form.contentTypes.length === 0)
        setForm(f => ({ ...f, contentTypes: contentOpts.map(ct => ct.id) }))
      setStep(3); return
    }
    if (step < 4) setStep(s => (s + 1) as WizardStep)
  }

  const goBack = () => {
    setError('')
    if (step === 4 && isUrl) { setStep(2); setPreview(null); return }
    if (step > 1) setStep(s => (s - 1) as WizardStep)
  }

  const resetWizard = () => { setForm(DEFAULT_FORM); setStep(1); setPreview(null); setError('') }

  const selectMode = (mode: InputMode) => {
    setForm(f => ({ ...f, inputMode: mode, input: '', contentTypes: [] }))
    setStep(2)
    setTimeout(() => inputRef.current?.focus(), 50)
  }

  const handleInputChange = (v: string) => {
    const autoUrl = v.startsWith('http://') || v.startsWith('https://')
    setForm(f => ({ ...f, input: v, inputMode: autoUrl ? 'url' : f.inputMode }))
    setError(''); setPreview(null)
  }

  const toggleType = (id: string) => {
    setForm(f => ({
      ...f,
      contentTypes: f.contentTypes.includes(id)
        ? f.contentTypes.filter(t => t !== id)
        : [...f.contentTypes, id],
    }))
  }

  const startScrape = async () => {
    const rawInput = form.input.trim()
    if (!rawInput) return
    setScraping(true); setError('')
    try {
      const url = isUrl ? rawInput : buildUsernameUrl(platform, rawInput)
      const { track, video, alreadyExists } = await trackApi.scrapeSocial(workspaceId, url, form.outputFormat)
      const name = track?.title ?? video?.title ?? rawInput
      setSuccess(alreadyExists ? t('sc_already_in_lib', { title: name }) : t('sc_added_success', { title: name }))
      onScrapeSuccess?.(form.outputFormat)
      setTimeout(() => { setSuccess(''); resetWizard() }, 3000)
    } catch (e) { setError(String(e).replace('Error: ', '')) }
    finally { setScraping(false) }
  }

  const autoUrlDetected = form.input.startsWith('http://') || form.input.startsWith('https://')

  return (
    <div className="rounded-md overflow-hidden" style={{ border: `1px solid ${S.border}`, background: S.panel }}>

      {/* ── Header: platform badge + step progress ── */}
      <div className="flex items-center gap-4 px-5 py-3.5 border-b"
        style={{ borderColor: S.border, background: S.panelAlt }}>

        {/* Platform badge */}
        <div className="flex items-center gap-2 shrink-0 px-2.5 py-1 rounded"
          style={{ background: `${accent}12`, border: `1px solid ${accent}25` }}>
          <PlatformIcon platform={platform} size={14} />
          <span className="text-xs font-semibold" style={{ color: accent }}>{PLATFORM_LABELS[platform]}</span>
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Step progress rail */}
        <div className="flex items-center shrink-0">
          {stepLabels.map((label, i) => {
            const n = i + 1
            const active = n === displayStep
            const done   = n < displayStep
            const isLast = i === stepLabels.length - 1
            return (
              <Fragment key={i}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
                  <div style={{
                    width: 22, height: 22, borderRadius: '50%',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 10, fontWeight: 700,
                    background: active ? accent : done ? 'rgba(46,184,114,0.15)' : S.input,
                    border: `1.5px solid ${active ? accent : done ? '#2eb872' : S.border}`,
                    color: active ? '#000' : done ? S.green : S.textMute,
                    transition: 'all 0.2s',
                  }}>
                    {done ? <Check size={10} /> : n}
                  </div>
                  <span style={{
                    fontSize: 9, whiteSpace: 'nowrap',
                    color: active ? S.textDim : done ? '#2eb87280' : S.textFade,
                  }}>
                    {label}
                  </span>
                </div>
                {!isLast && (
                  <div style={{
                    width: 36, height: 1.5, margin: '0 3px', marginBottom: 14,
                    background: done ? '#2eb87250' : S.border,
                    transition: 'background 0.3s',
                  }} />
                )}
              </Fragment>
            )
          })}
        </div>
      </div>

      {/* ── Body ── */}
      <div style={{ padding: '24px 24px 28px' }}>

        {/* ── STEP 1: Mode ── */}
        {step === 1 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div>
              <p style={{ color: S.text, fontSize: 15, fontWeight: 600, marginBottom: 4 }}>
                {t('step1_heading')}
              </p>
              <p style={{ color: S.textMute, fontSize: 12 }}>
                {t('step1_desc')}
              </p>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              {([
                {
                  id: 'url' as InputMode,
                  Icon: Link2,
                  label: t('mode_url_label'),
                  sub: t('mode_url_sub'),
                  tag: t('mode_url_tag'),
                },
                {
                  id: 'username' as InputMode,
                  Icon: AtSign,
                  label: t('mode_username_label'),
                  sub: t('mode_username_sub'),
                  tag: t('mode_username_tag'),
                },
              ]).map(m => (
                <button
                  key={m.id}
                  onClick={() => selectMode(m.id)}
                  className="text-left group"
                  style={{
                    padding: '18px 18px 16px',
                    borderRadius: 8,
                    border: `1px solid ${S.border}`,
                    background: S.input,
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                    outline: 'none',
                  }}
                  onMouseEnter={e => {
                    const el = e.currentTarget
                    el.style.border = `1px solid ${accent}50`
                    el.style.background = `${accent}08`
                  }}
                  onMouseLeave={e => {
                    const el = e.currentTarget
                    el.style.border = `1px solid ${S.border}`
                    el.style.background = S.input
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 10 }}>
                    <div style={{
                      width: 36, height: 36, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center',
                      background: `${accent}12`, border: `1px solid ${accent}20`,
                    }}>
                      <m.Icon size={16} style={{ color: accent }} />
                    </div>
                    <span style={{
                      fontSize: 9, fontWeight: 700, letterSpacing: '0.05em',
                      padding: '2px 6px', borderRadius: 3,
                      background: `${S.accent}15`, color: S.accent,
                      border: `1px solid ${S.accent}30`,
                    }}>
                      {m.tag}
                    </span>
                  </div>
                  <p style={{ color: S.text, fontSize: 13, fontWeight: 600, marginBottom: 4 }}>{m.label}</p>
                  <p style={{ color: S.textMute, fontSize: 11, lineHeight: 1.5 }}>{m.sub}</p>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 12, color: S.textFade }}>
                    <span style={{ fontSize: 10 }}>{t('social_mode_choose')}</span>
                    <ChevronRight size={11} />
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── STEP 2: Input ── */}
        {step === 2 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button
                onClick={goBack}
                style={{
                  padding: '5px 8px', borderRadius: 6,
                  border: `1px solid ${S.border}`, background: S.input,
                  color: S.textMute, cursor: 'pointer', display: 'flex', alignItems: 'center',
                  fontSize: 11,
                }}
              >{t('btn_back')}
              </button>
              <div>
                <p style={{ color: S.text, fontSize: 14, fontWeight: 600 }}>
                  {isUrl ? t('step2_url_heading') : t('step2_username_heading')}
                </p>
                <p style={{ color: S.textFade, fontSize: 11 }}>
                  {isUrl ? t('step2_url_sub') : t('step2_username_sub', { username: form.input || 'username', platform: PLATFORM_LABELS[platform] })}
                </p>
              </div>
            </div>

            {/* Input */}
            <div style={{ position: 'relative' }}>
              <div style={{
                display: 'flex', alignItems: 'center',
                border: `1px solid ${autoUrlDetected ? accent + '50' : S.border}`,
                borderRadius: 8, background: S.input,
                transition: 'border-color 0.15s',
              }}>
                <span style={{
                  padding: '0 12px', color: S.textFade, display: 'flex', alignItems: 'center',
                  borderRight: `1px solid ${S.border}`,
                }}>
                  {isUrl
                    ? <Link2 size={13} style={{ color: autoUrlDetected ? accent : S.textFade }} />
                    : <span style={{ fontSize: 13, fontWeight: 600, color: S.textMute }}>@</span>
                  }
                </span>
                <input
                  ref={inputRef}
                  value={form.input}
                  onChange={e => handleInputChange(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && form.input.trim() && goNext()}
                  placeholder={isUrl ? URL_EXAMPLES[platform] : 'username'}
                  style={{
                    flex: 1, background: 'transparent',
                    color: S.text, fontSize: 13,
                    padding: '10px 12px', outline: 'none', border: 'none',
                  }}
                />
                {autoUrlDetected && (
                  <span style={{
                    marginRight: 10, padding: '2px 7px', borderRadius: 3,
                    fontSize: 9, fontWeight: 700, letterSpacing: '0.04em',
                    background: `${accent}20`, color: accent, border: `1px solid ${accent}40`,
                    whiteSpace: 'nowrap',
                  }}>
                    URL ✓
                  </span>
                )}
              </div>
            </div>

            {error && <p style={{ color: S.red, fontSize: 12 }}>{error}</p>}

            <p style={{ color: S.textFade, fontSize: 11, lineHeight: 1.6 }}>
              {isUrl ? t('step2_url_info') : t('step2_username_info')}
            </p>

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                onClick={goNext}
                disabled={!form.input.trim() || loading}
                style={{
                  display: 'flex', alignItems: 'center', gap: 7,
                  padding: '9px 18px', borderRadius: 7,
                  backgroundColor: accent, color: '#000',
                  fontWeight: 700, fontSize: 13, cursor: 'pointer',
                  border: 'none', opacity: (!form.input.trim() || loading) ? 0.4 : 1,
                  transition: 'opacity 0.15s',
                }}
              >
                {loading && <Loader2 size={13} className="animate-spin" />}
                {t('btn_next')} <ChevronRight size={13} />
              </button>
            </div>
          </div>
        )}

        {/* ── STEP 3: Content types (username mode) ── */}
        {step === 3 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button
                onClick={goBack}
                style={{
                  padding: '5px 8px', borderRadius: 6,
                  border: `1px solid ${S.border}`, background: S.input,
                  color: S.textMute, cursor: 'pointer', fontSize: 11,
                }}
              >
                {t('btn_back')}
              </button>
              <div>
                <p style={{ color: S.text, fontSize: 14, fontWeight: 600 }}>
                  {t('step3_heading')}
                </p>
                <p style={{ color: S.textFade, fontSize: 11 }}>
                  Profil <span style={{ color: accent, fontWeight: 600 }}>@{form.input}</span>
                </p>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {contentOpts.map(ct => {
                const checked = form.contentTypes.includes(ct.id)
                return (
                  <button
                    key={ct.id}
                    onClick={() => toggleType(ct.id)}
                    style={{
                      display: 'flex', alignItems: 'flex-start', gap: 12,
                      padding: '14px 14px',
                      borderRadius: 8, textAlign: 'left', cursor: 'pointer',
                      border: `1px solid ${checked ? accent + '50' : S.border}`,
                      background: checked ? `${accent}0d` : S.input,
                      transition: 'all 0.15s', outline: 'none',
                    }}
                  >
                    <div style={{
                      marginTop: 1,
                      width: 16, height: 16, borderRadius: 4,
                      flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                      background: checked ? accent : 'transparent',
                      border: `1.5px solid ${checked ? accent : S.border}`,
                    }}>
                      {checked && <Check size={10} style={{ color: '#000' }} />}
                    </div>
                    <div>
                      <p style={{ fontSize: 12, fontWeight: 600, color: checked ? accent : S.text, marginBottom: 2 }}>
                        {ct.label}
                      </p>
                      <p style={{ fontSize: 10, color: S.textMute }}>{ct.desc}</p>
                    </div>
                  </button>
                )
              })}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <button
                onClick={() => setForm(f => ({ ...f, contentTypes: allSelected ? [] : contentOpts.map(ct => ct.id) }))}
                style={{ fontSize: 11, color: S.textFade, background: 'none', border: 'none', cursor: 'pointer' }}
              >
                {allSelected ? t('btn_deselect_all') : t('btn_select_all')}
              </button>
              <button
                onClick={goNext}
                disabled={form.contentTypes.length === 0}
                style={{
                  display: 'flex', alignItems: 'center', gap: 7,
                  padding: '9px 18px', borderRadius: 7,
                  backgroundColor: accent, color: '#000',
                  fontWeight: 700, fontSize: 13, cursor: 'pointer',
                  border: 'none', opacity: form.contentTypes.length === 0 ? 0.4 : 1,
                }}
              >
                {t('btn_next')} <ChevronRight size={13} />
              </button>
            </div>
          </div>
        )}

        {/* ── STEP 4: Format + submit ── */}
        {step === 4 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button
                onClick={goBack}
                style={{
                  padding: '5px 8px', borderRadius: 6,
                  border: `1px solid ${S.border}`, background: S.input,
                  color: S.textMute, cursor: 'pointer', fontSize: 11,
                }}
              >
                {t('btn_back')}
              </button>
              <div>
                <p style={{ color: S.text, fontSize: 14, fontWeight: 600 }}>{t('step4_heading')}</p>
                <p style={{ color: S.textFade, fontSize: 11 }}>{t('step4_desc')}</p>
              </div>
            </div>

            {/* Format cards */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {([
                { id: 'MP3' as OutputFormat, Icon: Music, label: t('format_mp3_label'), sub: t('format_mp3_sub'), dest: t('format_mp3_dest') },
                { id: 'MP4' as OutputFormat, Icon: Film,  label: t('format_mp4_label'), sub: t('format_mp4_sub'), dest: t('format_mp4_dest') },
              ]).map(({ id, Icon, label, sub, dest }) => {
                const sel = form.outputFormat === id
                return (
                  <button
                    key={id}
                    onClick={() => setForm(f => ({ ...f, outputFormat: id }))}
                    style={{
                      padding: '16px',
                      borderRadius: 8, textAlign: 'left', cursor: 'pointer',
                      border: `1px solid ${sel ? accent + '55' : S.border}`,
                      background: sel ? `${accent}0d` : S.input,
                      transition: 'all 0.15s', outline: 'none',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                      <div style={{
                        width: 32, height: 32, borderRadius: 7,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: sel ? `${accent}20` : S.panel,
                        border: `1px solid ${sel ? accent + '30' : S.border}`,
                      }}>
                        <Icon size={14} style={{ color: sel ? accent : S.textMute }} />
                      </div>
                      {sel && (
                        <div style={{ width: 16, height: 16, borderRadius: '50%', background: accent, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <Check size={10} style={{ color: '#000' }} />
                        </div>
                      )}
                    </div>
                    <p style={{ fontSize: 13, fontWeight: 700, color: sel ? accent : S.text, marginBottom: 2 }}>{label}</p>
                    <p style={{ fontSize: 11, color: S.textMute }}>{sub}</p>
                    <p style={{ fontSize: 10, color: S.textFade, marginTop: 2 }}>→ {dest}</p>
                  </button>
                )
              })}
            </div>

            {/* Preview (URL mode) */}
            {preview && isUrl && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 12, padding: '12px',
                borderRadius: 8, background: S.input, border: `1px solid ${S.border}`,
              }}>
                <div style={{
                  width: 44, height: 44, borderRadius: 6, overflow: 'hidden', flexShrink: 0,
                  background: S.panel, border: `1px solid ${S.border}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {preview.artworkUrl
                    ? <img src={preview.artworkUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    : <Film size={16} style={{ color: S.textFade }} />
                  }
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 13, fontWeight: 600, color: S.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {preview.title}
                  </p>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 3, fontSize: 11, color: S.textMute }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{preview.artist}</span>
                    {fmtDuration(preview.duration) && (
                      <>
                        <span style={{ color: S.textFade }}>·</span>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0 }}>
                          <Clock size={9} />{fmtDuration(preview.duration)}
                        </span>
                      </>
                    )}
                  </div>
                </div>
                {inLibrary && (
                  <span style={{
                    display: 'flex', alignItems: 'center', gap: 4,
                    padding: '3px 8px', borderRadius: 4, flexShrink: 0,
                    background: 'rgba(46,184,114,0.1)', color: S.green,
                    border: '1px solid rgba(46,184,114,0.2)', fontSize: 10,
                  }}>
                    <CheckCircle2 size={10} /> {t('in_library_badge')}
                  </span>
                )}
              </div>
            )}

            {/* Recap (username mode) */}
            {!isUrl && (
              <div style={{
                padding: '14px 16px', borderRadius: 8,
                background: S.input, border: `1px solid ${S.border}`,
              }}>
                <p style={{ fontSize: 9, letterSpacing: '0.1em', fontWeight: 700, color: S.textFade, marginBottom: 10, textTransform: 'uppercase' }}>
                  {t('recap_heading')}
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                  {[
                    { label: t('recap_platform'), value: <span style={{ fontWeight: 700, color: accent }}>{PLATFORM_LABELS[platform]}</span> },
                    { label: t('recap_username'),   value: <span style={{ fontWeight: 600, color: S.text }}>@{form.input}</span> },
                    { label: t('recap_content'),    value: (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {form.contentTypes.map(id => {
                          const ct = contentOpts.find(c => c.id === id)
                          return ct ? (
                            <span key={id} style={{
                              padding: '1px 7px', borderRadius: 3, fontSize: 10,
                              background: `${S.accent}15`, color: S.accent, border: `1px solid ${S.accent}25`,
                            }}>
                              {ct.label}
                            </span>
                          ) : null
                        })}
                      </div>
                    )},
                  ].map(row => (
                    <div key={row.label} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <span style={{ fontSize: 10, color: S.textMute, width: 68, flexShrink: 0 }}>{row.label}</span>
                      <span style={{ fontSize: 12 }}>{row.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {error   && <p style={{ color: S.red, fontSize: 12 }}>{error}</p>}
            {success && (
              <p style={{ display: 'flex', alignItems: 'center', gap: 6, color: S.green, fontSize: 12 }}>
                <CheckCircle2 size={13} />{success}
              </p>
            )}

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 4 }}>
              <button
                onClick={resetWizard}
                style={{ fontSize: 11, color: S.textFade, background: 'none', border: 'none', cursor: 'pointer' }}
              >
                {t('btn_reset_wizard')}
              </button>
              <button
                onClick={startScrape}
                disabled={scraping || !!success}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '10px 22px', borderRadius: 7,
                  backgroundColor: accent, color: '#000',
                  fontWeight: 700, fontSize: 13, cursor: 'pointer',
                  border: 'none', opacity: (scraping || !!success) ? 0.5 : 1,
                  transition: 'opacity 0.15s, transform 0.1s',
                }}
              >
                {scraping
                  ? <><Loader2 size={14} className="animate-spin" /> {t('btn_downloading')}</>
                  : <><Download size={14} /> {t('btn_start_download')}</>
                }
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
