import { useState, useEffect, useCallback } from 'react'
import {
  Palette, Globe, SlidersHorizontal, Link2, CreditCard,
  Check, Sun, Moon, Lock, Zap,
  Plus, Trash2, Pencil, ChevronDown, ChevronRight, Eye, EyeOff,
  RefreshCw,
} from 'lucide-react'
import {
  FaTiktok, FaInstagram, FaYoutube, FaXTwitter, FaFacebook,
  FaSnapchat, FaLinkedin, FaPinterest, FaTelegram, FaSoundcloud,
} from 'react-icons/fa6'
import { useAuth } from '../hooks/useAuth'
import { useWorkspace } from '../hooks/useWorkspace'
import { useI18n, LANGUAGES } from '../i18n'
import { socialApi, type SocialAccount, type SocialPlatform } from '../lib/api'
import type { TranslationKey } from '../i18n/types'

const S = {
  bg:       '#111',
  panel:    '#1a1a1a',
  panelAlt: '#161616',
  hover:    '#1e1e1e',
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
}

// ── Platform registry ────────────────────────────────────────────────────────
type PlatformInfo = {
  id: SocialPlatform
  label: string
  color: string
  bg: string
  description: string
  tokenLabel: string      // label for the access token field
  tokenPlaceholder: string
  tokenHint: string
  refreshLabel?: string
  refreshPlaceholder?: string
}

const PLATFORM_LIST: PlatformInfo[] = [
  {
    id: 'TIKTOK',
    label: 'TikTok',
    color: '#69C9D0',
    bg: 'rgba(105,201,208,0.12)',
    description: 'Publie des vidéos courtes sur TikTok.',
    tokenLabel: 'OAuth Access Token',
    tokenPlaceholder: 'act.XXXXXXXX... — token OAuth TikTok Content Posting API',
    tokenHint: 'Inscription sur developers.tiktok.com → créer une app → activer Content Posting API → OAuth 2.0 → scopes : video.upload, video.publish. Le token commence généralement par "act." ou "att.".',
    refreshLabel: 'Refresh Token (optionnel)',
    refreshPlaceholder: 'rft.XXXXXXXX... — pour renouvellement auto',
  },
  {
    id: 'INSTAGRAM',
    label: 'Instagram',
    color: '#E1306C',
    bg: 'rgba(225,48,108,0.12)',
    description: 'Publie des Reels et posts sur Instagram.',
    tokenLabel: 'Session token (sessionid)',
    tokenPlaceholder: 'Colle ici le cookie sessionid d\'Instagram',
    tokenHint: 'Ouvre Instagram dans le navigateur → F12 → Application → Cookies → copie la valeur de "sessionid"',
    refreshLabel: 'csrftoken',
    refreshPlaceholder: 'Valeur du cookie csrftoken',
  },
  {
    id: 'YOUTUBE',
    label: 'YouTube',
    color: '#FF0000',
    bg: 'rgba(255,0,0,0.12)',
    description: 'Publie des vidéos sur YouTube (Shorts inclus).',
    tokenLabel: 'OAuth Access Token',
    tokenPlaceholder: 'ya29.xxxx... — token OAuth Google',
    tokenHint: 'Obtenu via Google OAuth 2.0 (scope: youtube.upload). Voir la documentation.',
    refreshLabel: 'Refresh Token',
    refreshPlaceholder: '1//xxxx — refresh token pour renouvellement auto',
  },
  {
    id: 'TWITTER',
    label: 'X (Twitter)',
    color: '#1DA1F2',
    bg: 'rgba(29,161,242,0.12)',
    description: 'Publie des tweets avec vidéo sur X.',
    tokenLabel: 'Bearer Token / OAuth Token',
    tokenPlaceholder: 'AAAAAAAAAAAAAAAAAAAAAxx...',
    tokenHint: 'Crée une app sur developer.x.com → clé Bearer Token (API v2).',
    refreshLabel: 'API Secret (optionnel)',
    refreshPlaceholder: 'Secret OAuth 1.0a si nécessaire',
  },
  {
    id: 'FACEBOOK',
    label: 'Facebook',
    color: '#1877F2',
    bg: 'rgba(24,119,242,0.12)',
    description: 'Publie des Reels et vidéos sur Facebook Pages.',
    tokenLabel: 'Page Access Token',
    tokenPlaceholder: 'EAAxxxxx... — token de la Page Facebook',
    tokenHint: 'Via Graph API Explorer → choisir ta Page → générer un User Token avec manage_pages + publish_video.',
    refreshLabel: 'Page ID (optionnel)',
    refreshPlaceholder: 'ID numérique de la Page Facebook',
  },
  {
    id: 'SNAPCHAT',
    label: 'Snapchat',
    color: '#FFFC00',
    bg: 'rgba(255,252,0,0.1)',
    description: 'Publie des Stories sur Snapchat.',
    tokenLabel: 'OAuth Access Token',
    tokenPlaceholder: 'Token OAuth Snapchat Marketing API',
    tokenHint: 'Via Snapchat Business Manager → Ads Manager API → Access Token.',
  },
  {
    id: 'LINKEDIN',
    label: 'LinkedIn',
    color: '#0A66C2',
    bg: 'rgba(10,102,194,0.12)',
    description: 'Publie des vidéos sur LinkedIn.',
    tokenLabel: 'OAuth Access Token',
    tokenPlaceholder: 'AQVx... — token OAuth LinkedIn',
    tokenHint: 'Via LinkedIn Developer Portal → OAuth 2.0 → scopes: r_liteprofile w_member_social.',
    refreshLabel: 'Refresh Token',
    refreshPlaceholder: 'AQT... — refresh token',
  },
  {
    id: 'PINTEREST',
    label: 'Pinterest',
    color: '#E60023',
    bg: 'rgba(230,0,35,0.12)',
    description: 'Publie des épingles vidéo sur Pinterest.',
    tokenLabel: 'OAuth Access Token',
    tokenPlaceholder: 'pina_xxx... — token OAuth Pinterest v5',
    tokenHint: 'Via Pinterest Developers → créer une app → OAuth 2.0 → scope: pins:write.',
    refreshLabel: 'Refresh Token',
    refreshPlaceholder: 'pinr_xxx...',
  },
]

type Section = 'apparence' | 'langue' | 'preferences' | 'comptes' | 'abonnement'

const SECTIONS: { id: Section; key: TranslationKey; icon: React.ComponentType<{ size?: number; style?: React.CSSProperties }> }[] = [
  { id: 'apparence',   key: 'nav_appearance',   icon: Palette           },
  { id: 'langue',      key: 'nav_language',     icon: Globe             },
  { id: 'preferences', key: 'nav_preferences',  icon: SlidersHorizontal },
  { id: 'comptes',     key: 'nav_accounts',     icon: Link2             },
  { id: 'abonnement',  key: 'nav_subscription', icon: CreditCard        },
]

/* ── Reusable row ── */
function Row({ label, desc, children }: { label: string; desc?: string; children?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-6 py-4" style={{ borderBottom: `1px solid ${S.border}` }}>
      <div>
        <p className="text-sm font-medium" style={{ color: S.text }}>{label}</p>
        {desc && <p className="text-[11px] mt-0.5" style={{ color: S.textMute }}>{desc}</p>}
      </div>
      {children}
    </div>
  )
}

/* ── Toggle ── */
function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!on)}
      className="shrink-0 rounded-full transition-colors"
      style={{
        width: 36, height: 20,
        background: on ? S.accent : S.border,
        border: 'none', cursor: 'pointer', position: 'relative',
      }}
    >
      <span
        className="absolute top-0.5 rounded-full transition-transform"
        style={{
          width: 16, height: 16,
          background: on ? '#000' : S.textMute,
          left: 2,
          transform: on ? 'translateX(16px)' : 'translateX(0)',
        }}
      />
    </button>
  )
}

/* ── Badge ── */
function Soon() {
  const { t } = useI18n()
  return (
    <span
      className="text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded"
      style={{ background: `${S.textFade}30`, color: S.textFade, border: `1px solid ${S.border}` }}
    >
      {t('badge_soon')}
    </span>
  )
}

/* ── Section heading ── */
function SectionTitle({ label }: { label: string }) {
  return <h2 className="text-xs font-semibold uppercase tracking-wider mb-5" style={{ color: S.textMute }}>{label}</h2>
}

/* ── Platform brand icons ── */
const PLATFORM_ICON_MAP: Record<SocialPlatform, React.ComponentType<{ size?: number; style?: React.CSSProperties }>> = {
  TIKTOK:    FaTiktok,
  INSTAGRAM: FaInstagram,
  YOUTUBE:   FaYoutube,
  TWITTER:   FaXTwitter,
  FACEBOOK:  FaFacebook,
  SNAPCHAT:  FaSnapchat,
  LINKEDIN:  FaLinkedin,
  PINTEREST: FaPinterest,
}

function PlatformIcon({ platform, size = 18, color }: { platform: SocialPlatform; size?: number; color?: string }) {
  const Icon = PLATFORM_ICON_MAP[platform]
  return <Icon size={size} style={{ color, flexShrink: 0 }} />
}

/* ── Connect / edit form ── */
function ConnectForm({
  platform,
  existing,
  onSave,
  onCancel,
}: {
  platform: PlatformInfo
  existing?: SocialAccount
  onSave: (data: { accountName: string; accountLabel: string; accessToken: string; refreshToken: string }) => Promise<void>
  onCancel: () => void
}) {
  const [accountName,  setAccountName]  = useState(existing?.accountName  ?? '')
  const [accountLabel, setAccountLabel] = useState(existing?.accountLabel  ?? '')
  const [accessToken,  setAccessToken]  = useState('')
  const [refreshToken, setRefreshToken] = useState('')
  const [showToken,    setShowToken]    = useState(false)
  const [saving,       setSaving]       = useState(false)
  const [error,        setError]        = useState<string | null>(null)

  const handle = async () => {
    if (!accountName.trim()) { setError('Nom du compte requis'); return }
    if (!existing && !accessToken.trim()) { setError(`${platform.tokenLabel} requis`); return }
    setSaving(true); setError(null)
    try {
      await onSave({ accountName: accountName.trim(), accountLabel: accountLabel.trim(), accessToken: accessToken.trim(), refreshToken: refreshToken.trim() })
    } catch (e: unknown) { setError((e as Error).message) }
    finally { setSaving(false) }
  }

  return (
    <div className="rounded-lg p-4 mt-2" style={{ background: '#0d0d0d', border: `1px solid ${platform.color}30` }}>
      <div className="grid gap-3">
        {/* Account name */}
        <div>
          <label className="text-[9px] uppercase tracking-wider block mb-1" style={{ color: S.textMute }}>
            @username / Nom affiché *
          </label>
          <input value={accountName} onChange={e => setAccountName(e.target.value)}
            placeholder="@moncompte"
            className="w-full text-xs px-2.5 py-1.5 rounded outline-none"
            style={{ background: S.input, border: `1px solid ${S.border}`, color: S.text }} />
        </div>
        {/* Label */}
        <div>
          <label className="text-[9px] uppercase tracking-wider block mb-1" style={{ color: S.textMute }}>
            Étiquette (optionnel)
          </label>
          <input value={accountLabel} onChange={e => setAccountLabel(e.target.value)}
            placeholder="ex: Compte principal, Marque B..."
            className="w-full text-xs px-2.5 py-1.5 rounded outline-none"
            style={{ background: S.input, border: `1px solid ${S.border}`, color: S.text }} />
        </div>
        {/* Access token */}
        <div>
          <label className="text-[9px] uppercase tracking-wider block mb-1" style={{ color: S.textMute }}>
            {platform.tokenLabel}{existing ? ' (laisser vide pour ne pas changer)' : ' *'}
          </label>
          <div className="relative">
            <input value={accessToken} onChange={e => setAccessToken(e.target.value)}
              type={showToken ? 'text' : 'password'}
              placeholder={platform.tokenPlaceholder}
              className="w-full text-xs px-2.5 py-1.5 rounded outline-none pr-8"
              style={{ background: S.input, border: `1px solid ${S.border}`, color: S.text, fontFamily: 'monospace' }} />
            <button type="button" onClick={() => setShowToken(v => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2"
              style={{ color: S.textMute }}>
              {showToken ? <EyeOff size={11} /> : <Eye size={11} />}
            </button>
          </div>
          {/* Hint */}
          <p className="text-[9px] mt-1 leading-relaxed" style={{ color: S.textFade }}>
            💡 {platform.tokenHint}
          </p>
        </div>
        {/* Refresh token */}
        {platform.refreshLabel && (
          <div>
            <label className="text-[9px] uppercase tracking-wider block mb-1" style={{ color: S.textMute }}>
              {platform.refreshLabel}
            </label>
            <input value={refreshToken} onChange={e => setRefreshToken(e.target.value)}
              type="password"
              placeholder={platform.refreshPlaceholder}
              className="w-full text-xs px-2.5 py-1.5 rounded outline-none"
              style={{ background: S.input, border: `1px solid ${S.border}`, color: S.text, fontFamily: 'monospace' }} />
          </div>
        )}
      </div>

      {error && <p className="text-[10px] mt-2" style={{ color: S.red }}>{error}</p>}

      <div className="flex gap-2 mt-3">
        <button onClick={handle} disabled={saving}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold disabled:opacity-50"
          style={{ background: platform.color + '20', border: `1px solid ${platform.color}50`, color: platform.color }}>
          {saving ? <RefreshCw size={10} className="animate-spin" /> : <Check size={10} />}
          {existing ? 'Mettre à jour' : 'Connecter'}
        </button>
        <button onClick={onCancel}
          className="px-3 py-1.5 rounded text-xs"
          style={{ color: S.textMute, border: `1px solid ${S.border}` }}>
          Annuler
        </button>
      </div>
    </div>
  )
}

/* ── Single connected account card ── */
function AccountCard({
  account,
  platform,
  onEdit,
  onDelete,
}: {
  account: SocialAccount
  platform: PlatformInfo
  onEdit: () => void
  onDelete: () => void
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg mb-1"
      style={{ background: '#0f0f0f', border: `1px solid ${platform.color}20` }}>
      <div className="flex items-center gap-2.5 min-w-0">
        <PlatformIcon platform={account.platform} size={14} color={platform.color} />
        <div className="min-w-0">
          <p className="text-xs font-semibold truncate" style={{ color: S.text }}>{account.accountName}</p>
          {account.accountLabel && (
            <p className="text-[9px] truncate" style={{ color: S.textMute }}>{account.accountLabel}</p>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <span className="flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded"
          style={{ background: `${S.green}15`, color: S.green, border: `1px solid ${S.green}30` }}>
          <Check size={8} /> Connecté
        </span>
        <button onClick={onEdit}
          className="p-1 rounded hover:brightness-150"
          style={{ color: S.textMute }}>
          <Pencil size={11} />
        </button>
        <button onClick={onDelete}
          className="p-1 rounded hover:brightness-150"
          style={{ color: S.red + '88' }}>
          <Trash2 size={11} />
        </button>
      </div>
    </div>
  )
}

/* ── Platform section (collapsible) ── */
function PlatformSection({
  platform,
  accounts,
  onRefresh,
  wsId,
}: {
  platform: PlatformInfo
  accounts: SocialAccount[]
  onRefresh: () => void
  wsId: string
}) {
  const [open,       setOpen]       = useState(accounts.length > 0)
  const [showForm,   setShowForm]   = useState(false)
  const [editId,     setEditId]     = useState<string | null>(null)
  const [deleting,   setDeleting]   = useState<string | null>(null)

  const handleConnect = useCallback(async (data: {
    accountName: string; accountLabel: string; accessToken: string; refreshToken: string
  }) => {
    await socialApi.connect(wsId, platform.id, {
      accountName:  data.accountName,
      accountLabel: data.accountLabel || undefined,
      accessToken:  data.accessToken,
      refreshToken: data.refreshToken || undefined,
    })
    setShowForm(false)
    onRefresh()
  }, [wsId, platform.id, onRefresh])

  const handleUpdate = useCallback(async (accountId: string, data: {
    accountName: string; accountLabel: string; accessToken: string; refreshToken: string
  }) => {
    await socialApi.update(wsId, accountId, {
      accountName:  data.accountName,
      accountLabel: data.accountLabel || undefined,
      ...(data.accessToken  && { accessToken:  data.accessToken }),
      ...(data.refreshToken && { refreshToken: data.refreshToken }),
    })
    setEditId(null)
    onRefresh()
  }, [wsId, onRefresh])

  const handleDelete = useCallback(async (accountId: string) => {
    setDeleting(accountId)
    try { await socialApi.disconnect(wsId, accountId); onRefresh() }
    catch (e: unknown) { alert((e as Error).message) }
    finally { setDeleting(null) }
  }, [wsId, onRefresh])

  return (
    <div className="mb-3 rounded-xl overflow-hidden" style={{ border: `1px solid ${platform.color}25` }}>
      {/* Header */}
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-4 py-3"
        style={{ background: platform.bg }}>
        <div className="flex items-center gap-3">
          <PlatformIcon platform={platform.id} size={20} color={platform.color} />
          <div className="text-left">
            <p className="text-sm font-semibold" style={{ color: platform.color }}>{platform.label}</p>
            <p className="text-[10px]" style={{ color: S.textMute }}>{platform.description}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {accounts.length > 0 && (
            <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold"
              style={{ background: `${platform.color}20`, color: platform.color }}>
              {accounts.length} compte{accounts.length > 1 ? 's' : ''}
            </span>
          )}
          {open ? <ChevronDown size={13} style={{ color: S.textMute }} /> : <ChevronRight size={13} style={{ color: S.textMute }} />}
        </div>
      </button>

      {/* Body */}
      {open && (
        <div className="p-3" style={{ background: '#0c0c0c' }}>
          {accounts.map(acc => (
            <div key={acc.id}>
              {editId === acc.id ? (
                <ConnectForm
                  platform={platform}
                  existing={acc}
                  onSave={data => handleUpdate(acc.id, data)}
                  onCancel={() => setEditId(null)}
                />
              ) : (
                <AccountCard
                  account={acc}
                  platform={platform}
                  onEdit={() => setEditId(acc.id)}
                  onDelete={() => {
                    if (!confirm(`Déconnecter "${acc.accountName}" ?`)) return
                    handleDelete(acc.id)
                  }}
                />
              )}
              {deleting === acc.id && (
                <p className="text-[10px] mt-1" style={{ color: S.textMute }}>Déconnexion…</p>
              )}
            </div>
          ))}

          {/* Add new account */}
          {showForm ? (
            <ConnectForm
              platform={platform}
              onSave={handleConnect}
              onCancel={() => setShowForm(false)}
            />
          ) : (
            <button
              onClick={() => setShowForm(true)}
              className="flex items-center gap-1.5 w-full px-3 py-2 rounded-lg text-xs mt-1 hover:brightness-150"
              style={{ color: platform.color, background: `${platform.color}08`, border: `1px dashed ${platform.color}40` }}>
              <Plus size={11} /> Ajouter un compte {platform.label}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export default function Settings() {
  useAuth()
  const { workspace } = useWorkspace()
  const { lang, setLang, t } = useI18n()
  const [section, setSection] = useState<Section>('apparence')

  // Apparence
  const [theme, setTheme] = useState<'dark' | 'light'>('dark')

  // Préférences
  const [autoplay,      setAutoplay]      = useState(true)
  const [quality,       setQuality]       = useState<'high' | 'medium' | 'low'>('high')
  const [desktopNotifs, setDesktopNotifs] = useState(false)
  const [emailNotifs,   setEmailNotifs]   = useState(true)
  const [reducedMotion, setReducedMotion] = useState(false)

  // Social accounts
  const [socialAccounts, setSocialAccounts] = useState<SocialAccount[]>([])
  const [loadingAccounts, setLoadingAccounts] = useState(false)

  const loadAccounts = useCallback(async () => {
    if (!workspace) return
    setLoadingAccounts(true)
    try { setSocialAccounts((await socialApi.listAccounts(workspace.id)).accounts) }
    catch { /* ignore */ }
    finally { setLoadingAccounts(false) }
  }, [workspace])

  useEffect(() => {
    if (section === 'comptes') loadAccounts()
  }, [section, loadAccounts])

  return (
    <div className="flex flex-col h-full fade-in" style={{ background: S.bg, color: S.text }}>

      {/* Top bar */}
      <div
        className="flex items-center gap-3 px-4 shrink-0"
        style={{ height: 36, borderBottom: `1px solid ${S.border}`, background: S.panelAlt }}
      >
        <SlidersHorizontal size={13} style={{ color: S.accent }} />
        <span className="text-sm font-semibold" style={{ color: S.text }}>{t('page_title_settings')}</span>
      </div>

      {/* Body */}
      <div className="flex flex-col sm:flex-row flex-1 min-h-0">

        {/* Left nav — horizontal scrollable tabs on mobile, vertical sidebar on sm+ */}
        <nav
          className="flex flex-row sm:flex-col overflow-x-auto sm:overflow-visible shrink-0 sm:w-[200px] gap-0.5 px-2 py-1.5 sm:py-3 border-b sm:border-b-0 sm:border-r"
          style={{ borderColor: S.border, background: S.panelAlt }}
        >
          {SECTIONS.map(({ id, key, icon: Icon }) => {
            const active = section === id
            return (
              <button
                key={id}
                onClick={() => setSection(id)}
                className="flex items-center gap-2 shrink-0 sm:w-full text-left text-xs font-medium px-3 py-2 rounded whitespace-nowrap"
                style={{
                  background: active ? S.hover : 'transparent',
                  color: active ? S.text : S.textMute,
                  border: 'none', cursor: 'pointer',
                  borderBottom: `2px solid ${active ? S.accent : 'transparent'}`,
                }}
                onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.background = S.hover }}
                onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.background = 'transparent' }}
              >
                <Icon size={13} style={{ color: active ? S.accent : S.textMute }} />
                {t(key)}
              </button>
            )
          })}
        </nav>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-7">
          <div className="max-w-2xl">

            {/* ── APPARENCE ── */}
            {section === 'apparence' && (
              <>
                <SectionTitle label={t('section_appearance')} />
                <div style={{ background: S.panel, border: `1px solid ${S.border}`, borderRadius: 8, padding: '0 20px' }}>
                  <Row label={t('row_theme')} desc={t('row_theme_desc')}>
                    <div className="flex gap-2">
                      {([
                        { id: 'dark' as const,  icon: Moon, label: t('theme_dark')  },
                        { id: 'light' as const, icon: Sun,  label: t('theme_light') },
                      ]).map(({ id, icon: Icon, label }) => {
                        const active = theme === id
                        const disabled = id === 'light'
                        return (
                          <button
                            key={id}
                            onClick={() => !disabled && setTheme(id)}
                            disabled={disabled}
                            className="flex flex-col items-center gap-1.5 px-4 py-3 rounded-md text-[11px] font-medium transition-colors"
                            style={{
                              background: active ? `${S.accent}15` : S.panelAlt,
                              border: `1px solid ${active ? S.accent : S.border}`,
                              color: active ? S.accent : S.textMute,
                              cursor: disabled ? 'default' : 'pointer',
                              opacity: disabled ? 0.45 : 1,
                            }}
                          >
                            <Icon size={16} />
                            {label}
                            {disabled && <Soon />}
                          </button>
                        )
                      })}
                    </div>
                  </Row>
                  <Row label={t('row_reduced_motion')} desc={t('row_reduced_motion_desc')}>
                    <Toggle on={reducedMotion} onChange={setReducedMotion} />
                  </Row>
                </div>
              </>
            )}

            {/* ── LANGUE ── */}
            {section === 'langue' && (
              <>
                <SectionTitle label={t('section_language_region')} />
                <div style={{ background: S.panel, border: `1px solid ${S.border}`, borderRadius: 8, padding: '0 20px' }}>
                  <Row label={t('row_interface_lang')} desc={t('row_interface_lang_desc')}>
                    <select
                      value={lang}
                      onChange={e => setLang(e.target.value as Parameters<typeof setLang>[0])}
                      className="text-xs rounded-md px-3 py-2 outline-none"
                      style={{ background: S.input, color: S.text, border: `1px solid ${S.border}`, cursor: 'pointer' }}
                    >
                      {LANGUAGES.map(l => (
                        <option key={l.code} value={l.code}>{l.flag} {l.label}</option>
                      ))}
                    </select>
                  </Row>
                  <Row label={t('row_date_format')} desc={t('row_date_format_desc')}>
                    <span className="text-xs font-mono" style={{ color: S.textDim }}>
                      {lang === 'en' ? 'MM/DD/YYYY' : 'DD/MM/YYYY'}
                    </span>
                  </Row>
                  <Row label={t('row_timezone')} desc={t('row_timezone_desc')}>
                    <span className="text-xs font-mono" style={{ color: S.textDim }}>
                      {Intl.DateTimeFormat().resolvedOptions().timeZone}
                    </span>
                  </Row>
                </div>
              </>
            )}

            {/* ── PREFERENCES ── */}
            {section === 'preferences' && (
              <>
                <SectionTitle label={t('section_preferences')} />
                <div style={{ background: S.panel, border: `1px solid ${S.border}`, borderRadius: 8, padding: '0 20px' }} className="mb-5">
                  <Row label={t('row_autoplay')} desc={t('row_autoplay_desc')}>
                    <Toggle on={autoplay} onChange={setAutoplay} />
                  </Row>
                  <Row label={t('row_audio_quality')} desc={t('row_audio_quality_desc')}>
                    <div className="flex gap-1.5">
                      {(['high', 'medium', 'low'] as const).map(q => (
                        <button
                          key={q}
                          onClick={() => setQuality(q)}
                          className="px-3 py-1.5 rounded text-[11px] font-medium"
                          style={{
                            background: quality === q ? `${S.accent}15` : S.panelAlt,
                            border: `1px solid ${quality === q ? S.accent : S.border}`,
                            color: quality === q ? S.accent : S.textMute,
                            cursor: 'pointer',
                          }}
                        >
                          {q === 'high' ? t('quality_high') : q === 'medium' ? t('quality_medium') : t('quality_low')}
                        </button>
                      ))}
                    </div>
                  </Row>
                </div>

                <SectionTitle label={t('section_notifications')} />
                <div style={{ background: S.panel, border: `1px solid ${S.border}`, borderRadius: 8, padding: '0 20px' }}>
                  <Row label={t('row_desktop_notifs')} desc={t('row_desktop_notifs_desc')}>
                    <Toggle on={desktopNotifs} onChange={setDesktopNotifs} />
                  </Row>
                  <Row label={t('row_email_notifs')} desc={t('row_email_notifs_desc')}>
                    <Toggle on={emailNotifs} onChange={setEmailNotifs} />
                  </Row>
                </div>
              </>
            )}

            {/* ── COMPTES CONNECTES ── */}
            {section === 'comptes' && (
              <>
                {/* App accounts (SoundCloud / Telegram) */}
                <SectionTitle label="Comptes d'application" />
                <div style={{ background: S.panel, border: `1px solid ${S.border}`, borderRadius: 8, overflow: 'hidden' }} className="mb-8">
                  {/* SoundCloud */}
                  <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: `1px solid ${S.border}` }}>
                    <div className="flex items-center gap-3">
                      <div className="flex items-center justify-center rounded shrink-0"
                        style={{ width: 36, height: 36, background: 'rgba(255,85,0,0.1)', border: '1px solid rgba(255,85,0,0.2)' }}>
                        <FaSoundcloud size={18} style={{ color: '#ff5500' }} />
                      </div>
                      <div>
                        <p className="text-sm font-medium" style={{ color: S.text }}>SoundCloud</p>
                        <p className="text-[11px]" style={{ color: S.textMute }}>{t('account_soundcloud_desc')}</p>
                      </div>
                    </div>
                    <span className="flex items-center gap-1 text-[11px]" style={{ color: S.green }}>
                      <Check size={11} />{t('account_connected')}
                    </span>
                  </div>

                  {/* Telegram */}
                  <div className="flex items-center justify-between px-5 py-4">
                    <div className="flex items-center gap-3">
                      <div className="flex items-center justify-center rounded shrink-0"
                        style={{ width: 36, height: 36, background: 'rgba(0,136,204,0.1)', border: '1px solid rgba(0,136,204,0.2)' }}>
                        <FaTelegram size={18} style={{ color: '#0088cc' }} />
                      </div>
                      <div>
                        <p className="text-sm font-medium" style={{ color: S.text }}>Telegram</p>
                        <p className="text-[11px]" style={{ color: S.textMute }}>{t('account_telegram_desc')}</p>
                      </div>
                    </div>
                    <span className="flex items-center gap-1 text-[11px]" style={{ color: S.green }}>
                      <Check size={11} />{t('account_connected')}
                    </span>
                  </div>
                </div>

                {/* Social networks — multi-account */}
                <div className="flex items-center justify-between mb-5">
                  <SectionTitle label="Réseaux sociaux — publication" />
                  <button onClick={loadAccounts} disabled={loadingAccounts}
                    className="flex items-center gap-1 text-[10px] px-2 py-1 rounded hover:brightness-150 disabled:opacity-40"
                    style={{ color: S.textMute, border: `1px solid ${S.border}` }}>
                    <RefreshCw size={9} className={loadingAccounts ? 'animate-spin' : ''} /> Actualiser
                  </button>
                </div>

                {/* Disclaimer */}
                <div className="mb-4 px-3 py-2.5 rounded-lg text-[10px] leading-relaxed"
                  style={{ background: '#1a1500', border: '1px solid #3a2e00', color: '#a08030' }}>
                  ⚠️ Les tokens de session (cookies) extraits du navigateur permettent de publier sans accès développeur officiel.
                  Utilisez un compte dédié — cette méthode va à l'encontre des CGU des plateformes.
                  Les tokens OAuth officiels (YouTube, LinkedIn) sont stables et sans risque.
                </div>

                {workspace && PLATFORM_LIST.map(platform => (
                  <PlatformSection
                    key={platform.id}
                    platform={platform}
                    accounts={socialAccounts.filter(a => a.platform === platform.id)}
                    onRefresh={loadAccounts}
                    wsId={workspace.id}
                  />
                ))}

                <p className="mt-4 text-[11px]" style={{ color: S.textFade }}>
                  {t('accounts_more_integrations')}
                </p>
              </>
            )}

            {/* ── ABONNEMENT ── */}
            {section === 'abonnement' && (
              <>
                <SectionTitle label={t('section_subscription')} />

                {/* Current plan */}
                <div className="mb-5 p-5 rounded-lg" style={{ background: S.panel, border: `1px solid ${S.border}` }}>
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <p className="text-[10px] uppercase tracking-wide mb-1" style={{ color: S.textMute }}>{t('plan_current_label')}</p>
                      <p className="text-2xl font-bold" style={{ color: S.text }}>{t('plan_free')}</p>
                    </div>
                    <span className="text-[10px] font-semibold px-2 py-1 rounded"
                      style={{ background: `${S.accent}18`, color: S.accent, border: `1px solid ${S.accent}30` }}>
                      {t('plan_active_badge')}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {([
                      { key: 'feature_1_workspace'        as TranslationKey, ok: true  },
                      { key: 'feature_5_bots'             as TranslationKey, ok: true  },
                      { key: 'feature_10gb'               as TranslationKey, ok: true  },
                      { key: 'feature_unlimited_scraping' as TranslationKey, ok: false },
                      { key: 'feature_tiktok_export'      as TranslationKey, ok: false },
                      { key: 'feature_priority_support'   as TranslationKey, ok: false },
                    ]).map(({ key, ok }) => (
                      <div key={key} className="flex items-center gap-2 text-[11px]"
                        style={{ color: ok ? S.textDim : S.textFade }}>
                        <span style={{ color: ok ? S.green : S.textFade, flexShrink: 0 }}>
                          {ok ? '✓' : '–'}
                        </span>
                        {t(key)}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Pro plan */}
                <div className="p-5 rounded-lg relative overflow-hidden"
                  style={{ background: S.panel, border: `1px solid ${S.borderHi}`, borderLeft: `2px solid ${S.accent}` }}>
                  <div className="flex items-start justify-between mb-1">
                    <div>
                      <p className="text-[10px] uppercase tracking-wide mb-1" style={{ color: S.accent }}>{t('plan_pro')}</p>
                      <p className="text-2xl font-bold" style={{ color: S.text }}>
                        9,99 €<span className="text-sm font-normal" style={{ color: S.textMute }}> {t('plan_pro_per_month')}</span>
                      </p>
                    </div>
                    <Soon />
                  </div>
                  <p className="text-[11px] mb-4" style={{ color: S.textMute }}>{t('plan_pro_desc')}</p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-5">
                    {(['feature_unlimited_workspaces', 'feature_unlimited_bots', 'feature_100gb', 'feature_tiktok_export', 'feature_youtube_export', 'feature_priority_support'] as TranslationKey[]).map(key => (
                      <div key={key} className="flex items-center gap-2 text-[11px]" style={{ color: S.textDim }}>
                        <Zap size={10} style={{ color: S.accent, flexShrink: 0 }} />{t(key)}
                      </div>
                    ))}
                  </div>
                  <button disabled className="flex items-center gap-2 px-5 py-2.5 rounded-md text-sm font-semibold opacity-40"
                    style={{ background: S.accent, color: '#000', border: 'none', cursor: 'default' }}>
                    <Lock size={14} />{t('btn_coming_soon_lock')}
                  </button>
                </div>

                <p className="mt-4 text-[11px]" style={{ color: S.textFade }}>{t('billing_contact_note')}</p>
              </>
            )}

          </div>
        </div>
      </div>
    </div>
  )
}
