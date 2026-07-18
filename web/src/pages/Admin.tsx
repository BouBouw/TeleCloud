import { useState, useEffect, useCallback } from 'react'
import {
  Users, Shield, Server, Database,
  Activity, Settings, Zap, ShieldCheck, Loader2, HardDrive, Cookie, Check, Trash2, ExternalLink,
} from 'lucide-react'
import { adminApi } from '../lib/api'
import type { AdminStats, AdminUser } from '../lib/api'
import { useI18n } from '../i18n'

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
  green:    '#4ade80',
  cyan:     '#67e8f9',
  pink:     '#f472b6',
  red:      '#e74c3c',
}

const ROLES = ['USER', 'MOD', 'ADMIN'] as const
type Role = typeof ROLES[number]

const ROLE_COLOR: Record<Role, string> = {
  USER:  S.textMute,
  MOD:   S.cyan,
  ADMIN: S.accent,
}

function fmtUptime(s: number) {
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (d > 0) return `${d}j ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

function fmtBytes(b: number) {
  if (b >= 1e9) return `${(b / 1e9).toFixed(1)} GB`
  if (b >= 1e6) return `${(b / 1e6).toFixed(0)} MB`
  return `${(b / 1e3).toFixed(0)} KB`
}

export default function Admin() {
  const { t } = useI18n()
  const [stats,       setStats]       = useState<AdminStats | null>(null)
  const [users,       setUsers]       = useState<AdminUser[]>([])
  const [loadingStats, setLoadingStats] = useState(true)
  const [loadingUsers, setLoadingUsers] = useState(true)
  const [roleLoading,  setRoleLoading]  = useState<string | null>(null)

  // YouTube cookies state
  const [ytCookies, setYtCookies] = useState<{ configured: boolean; lines: number; mtime?: string } | null>(null)
  const [ytCookieText, setYtCookieText] = useState('')
  const [ytSaving, setYtSaving] = useState(false)
  const [ytMsg, setYtMsg] = useState('')

  const loadStats = useCallback(async () => {
    try { setStats(await adminApi.stats()) }
    catch { /* ignore */ }
    finally { setLoadingStats(false) }
  }, [])

  const loadUsers = useCallback(async () => {
    try {
      const { users: u } = await adminApi.users()
      setUsers(u)
    } catch { /* ignore */ }
    finally { setLoadingUsers(false) }
  }, [])

  useEffect(() => { loadStats(); loadUsers() }, [loadStats, loadUsers])

  useEffect(() => {
    adminApi.getYouTubeCookies().then(setYtCookies).catch(() => {})
  }, [])

  const handleSaveYtCookies = async () => {
    if (!ytCookieText.trim()) return
    setYtSaving(true); setYtMsg('')
    try {
      const r = await adminApi.saveYouTubeCookies(ytCookieText)
      setYtCookies({ configured: true, lines: r.lines, mtime: new Date().toISOString() })
      setYtCookieText('')
      setYtMsg(`✓ ${r.lines} entrées sauvegardées — YouTube devrait maintenant fonctionner`)
    } catch (e) { setYtMsg('Erreur: ' + String(e)) }
    finally { setYtSaving(false) }
  }

  const handleDeleteYtCookies = async () => {
    await adminApi.deleteYouTubeCookies()
    setYtCookies({ configured: false, lines: 0 })
    setYtMsg('')
  }

  const handleRoleChange = async (userId: string, role: string) => {
    setRoleLoading(userId)
    try {
      const { user: updated } = await adminApi.setRole(userId, role)
      setUsers(prev => prev.map(u => u.id === updated.id ? updated : u))
    } catch { /* ignore */ }
    finally { setRoleLoading(null) }
  }
  return (
    <div className="flex flex-col h-full fade-in" style={{ background: S.bg, color: S.text }}>

      {/* Top bar */}
      <div
        className="flex items-center gap-3 px-4 border-b shrink-0"
        style={{ borderColor: S.border, height: 36 }}
      >
        <ShieldCheck size={13} style={{ color: S.accent }} />
        <span className="text-sm font-semibold" style={{ color: S.text }}>{t('page_title_admin')}</span>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-3 sm:p-5">

        {/* Stats grid */}
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 mb-5">
          {[
            {
              label: t('stat_total_users_label'),
              value: loadingStats ? '—' : String(stats?.userCount ?? 0),
              icon: Users, accent: S.cyan,
            },
            {
              label: t('stat_active_bots_label'),
              value: loadingStats ? '—' : `${stats?.activeBots ?? 0} / ${stats?.botCount ?? 0}`,
              icon: Zap, accent: S.accent,
            },
            {
              label: t('stat_server_uptime_label'),
              value: loadingStats ? '—' : fmtUptime(stats?.uptimeSeconds ?? 0),
              icon: Server, accent: S.green,
            },
            {
              label: t('stat_db_size_label'),
              value: loadingStats ? '—' : fmtBytes(stats?.storageBytes ?? 0),
              icon: Database, accent: S.pink,
            },
          ].map(({ label, value, icon: Icon, accent }) => (
            <div
              key={label}
              style={{
                background: S.panel,
                border: `1px solid ${S.border}`,
                borderLeft: `2px solid ${accent}`,
                borderRadius: 8,
                padding: '14px 16px',
              }}
            >
              <div
                className="flex items-center justify-center rounded mb-3"
                style={{ width: 30, height: 30, background: S.panelAlt, border: `1px solid ${S.border}` }}
              >
                <Icon size={14} style={{ color: accent }} />
              </div>
              <p className="text-lg font-bold tabular-nums" style={{ color: S.text }}>{value}</p>
              <p className="text-[10px] mt-0.5" style={{ color: S.textMute }}>{label}</p>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-5 mb-5">

          {/* User management */}
          <div style={{ background: S.panel, border: `1px solid ${S.border}`, borderRadius: 8, overflow: 'hidden' }}>
            <div
              className="flex items-center justify-between px-4"
              style={{ height: 40, borderBottom: `1px solid ${S.border}`, background: S.panelAlt }}
            >
              <span className="flex items-center gap-2 text-xs font-semibold" style={{ color: S.text }}>
                <Users size={12} style={{ color: S.cyan }} />{t('section_user_mgmt')}
                {!loadingUsers && (
                  <span className="font-normal tabular-nums" style={{ color: S.textFade }}>({users.length})</span>
                )}
              </span>
              <button
                className="flex items-center gap-1 text-[10px] hover:brightness-125"
                style={{ color: S.accent, background: 'transparent', border: 'none', cursor: 'pointer' }}
              >
                <Settings size={10} />{t('btn_roles')}
              </button>
            </div>

            {loadingUsers ? (
              <div className="flex items-center justify-center py-10">
                <Loader2 size={16} className="animate-spin" style={{ color: S.accent }} />
              </div>
            ) : users.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 gap-2">
                <Users size={18} style={{ color: S.textFade }} />
                <p className="text-xs" style={{ color: S.textMute }}>{t('user_mgmt_empty')}</p>
              </div>
            ) : (
              <div className="divide-y" style={{ borderColor: S.border }}>
                {users.map(u => (
                  <div
                    key={u.id}
                    className="flex items-center gap-3 px-4 py-2.5"
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = S.panelAlt }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = '' }}
                  >
                    {/* Avatar */}
                    <div
                      className="flex items-center justify-center rounded-full shrink-0 text-[10px] font-bold"
                      style={{
                        width: 28, height: 28,
                        background: S.panelAlt, border: `1px solid ${S.border}`,
                        color: S.textDim,
                      }}
                    >
                      {(u.displayName || u.email).slice(0, 2).toUpperCase()}
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium truncate" style={{ color: S.text }}>
                        {u.displayName || u.email}
                      </p>
                      <p className="text-[10px] truncate" style={{ color: S.textFade }}>{u.email}</p>
                    </div>

                    {/* Role selector */}
                    <div className="relative shrink-0">
                      {roleLoading === u.id ? (
                        <Loader2 size={12} className="animate-spin" style={{ color: S.accent }} />
                      ) : (
                        <select
                          value={u.globalRole}
                          onChange={e => handleRoleChange(u.id, e.target.value)}
                          className="text-[10px] rounded px-1.5 py-0.5 outline-none"
                          style={{
                            background: S.panelAlt,
                            border: `1px solid ${S.border}`,
                            color: ROLE_COLOR[u.globalRole as Role] ?? S.textMute,
                            cursor: 'pointer',
                          }}
                        >
                          {ROLES.map(r => (
                            <option key={r} value={r}>{r}</option>
                          ))}
                        </select>
                      )}
                    </div>

                    {/* Created */}
                    <span className="text-[9px] tabular-nums shrink-0 hidden lg:block" style={{ color: S.textFade }}>
                      {new Date(u.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* System logs */}
          <div style={{ background: S.panel, border: `1px solid ${S.border}`, borderRadius: 8, overflow: 'hidden' }}>
            <div
              className="flex items-center justify-between px-4"
              style={{ height: 40, borderBottom: `1px solid ${S.border}`, background: S.panelAlt }}
            >
              <span className="flex items-center gap-2 text-xs font-semibold" style={{ color: S.text }}>
                <Activity size={12} style={{ color: S.green }} />{t('section_system_logs')}
              </span>
            </div>
            <div className="flex flex-col items-center justify-center py-12 gap-2">
              <div
                className="flex items-center justify-center rounded"
                style={{ width: 44, height: 44, background: S.panelAlt, border: `1px solid ${S.border}` }}
              >
                <Activity size={18} style={{ color: S.textFade }} />
              </div>
              <p className="text-xs" style={{ color: S.textMute }}>{t('logs_empty')}</p>
            </div>
          </div>
        </div>

        {/* YouTube Cookies */}
        <div style={{ background: S.panel, border: `1px solid ${S.border}`, borderRadius: 8, overflow: 'hidden' }}>
          <div className="flex items-center justify-between px-4"
            style={{ height: 40, borderBottom: `1px solid ${S.border}`, background: S.panelAlt }}>
            <span className="flex items-center gap-2 text-xs font-semibold" style={{ color: S.text }}>
              <Cookie size={12} style={{ color: '#FF0000' }} />
              Cookies YouTube (bypass bot check)
            </span>
            {ytCookies?.configured && (
              <span className="flex items-center gap-1 text-[10px]" style={{ color: S.green }}>
                <Check size={10} /> Configuré · {ytCookies.lines} entrées
              </span>
            )}
          </div>
          <div className="p-4 flex flex-col gap-3">
            {/* Status */}
            <div className="flex items-start gap-3 p-3 rounded text-[11px] leading-relaxed"
              style={{ background: ytCookies?.configured ? '#4ade8010' : '#f0a83010', border: `1px solid ${ytCookies?.configured ? '#4ade8030' : '#f0a83030'}`, color: S.textDim }}>
              {ytCookies?.configured ? (
                <span>
                  ✓ Cookies actifs ({ytCookies.lines} domaines) — mise à jour {ytCookies.mtime ? new Date(ytCookies.mtime).toLocaleDateString('fr') : ''}.<br />
                  Les téléchargements YouTube contournent maintenant le bot-check. À renouveler si tu vois à nouveau l'erreur "Sign in to confirm".
                </span>
              ) : (
                <span>
                  ⚠ Aucun cookie configuré — YouTube bloque les téléchargements depuis cette IP de serveur.<br />
                  Colle tes cookies YouTube ci-dessous pour bypasser la protection.
                </span>
              )}
            </div>

            {/* Instructions */}
            <details className="text-[10px]" style={{ color: S.textMute }}>
              <summary className="cursor-pointer hover:brightness-150 flex items-center gap-1">
                <ExternalLink size={9} /> Comment exporter mes cookies YouTube ?
              </summary>
              <ol className="mt-2 ml-3 flex flex-col gap-1 list-decimal" style={{ color: S.textFade }}>
                <li>Installe l'extension <strong style={{ color: S.textDim }}>"Get cookies.txt LOCALLY"</strong> sur Chrome/Firefox</li>
                <li>Va sur <strong style={{ color: S.textDim }}>youtube.com</strong> en étant connecté à ton compte Google</li>
                <li>Clique sur l'extension → <strong style={{ color: S.textDim }}>"Export As" → "Cookies.txt (Current Site)"</strong></li>
                <li>Ouvre le fichier téléchargé, copie-colle tout le contenu ici</li>
                <li>Clique Sauvegarder</li>
              </ol>
            </details>

            {/* Paste area */}
            <textarea
              value={ytCookieText}
              onChange={e => setYtCookieText(e.target.value)}
              placeholder="# Netscape HTTP Cookie File&#10;.youtube.com	TRUE	/	TRUE	1234567890	VISITOR_INFO1_LIVE	xxxx&#10;..."
              rows={6}
              className="w-full text-[9px] font-mono rounded px-2 py-2 resize-y outline-none"
              style={{ background: '#080808', border: `1px solid ${S.border}`, color: '#888', lineHeight: 1.5 }}
            />

            {ytMsg && (
              <p className="text-[10px]" style={{ color: ytMsg.startsWith('✓') ? S.green : S.red }}>{ytMsg}</p>
            )}

            <div className="flex gap-2">
              <button onClick={handleSaveYtCookies} disabled={ytSaving || !ytCookieText.trim()}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold disabled:opacity-40"
                style={{ background: '#FF0000', color: '#fff' }}>
                {ytSaving ? <Loader2 size={11} className="animate-spin" /> : <Cookie size={11} />}
                Sauvegarder les cookies
              </button>
              {ytCookies?.configured && (
                <button onClick={handleDeleteYtCookies}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold"
                  style={{ background: '#1a1a1a', border: `1px solid ${S.border}`, color: S.red }}>
                  <Trash2 size={11} /> Supprimer
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Platform settings */}
        <div style={{ background: S.panel, border: `1px solid ${S.border}`, borderRadius: 8, overflow: 'hidden' }}>
          <div
            className="flex items-center gap-2 px-4"
            style={{ height: 40, borderBottom: `1px solid ${S.border}`, background: S.panelAlt }}
          >
            <Shield size={12} style={{ color: S.accent }} />
            <span className="text-xs font-semibold" style={{ color: S.text }}>{t('section_platform_settings')}</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4">
            {[
              {
                label: t('setting_max_bots_label'),
                value: loadingStats ? '—' : String(stats?.botCount ?? 0),
                sub: t('setting_max_bots_desc'),
                icon: Zap,
              },
              {
                label: t('setting_max_storage_label'),
                value: loadingStats ? '—' : fmtBytes(stats?.maxStorageBytes ?? 0),
                sub: t('setting_max_storage_desc'),
                icon: HardDrive,
              },
              {
                label: t('setting_rate_limit_label'),
                value: '200 req / 15min',
                sub: t('setting_rate_limit_desc'),
                icon: Activity,
              },
            ].map(item => (
              <div
                key={item.label}
                className="p-3 rounded transition-colors"
                style={{ background: S.panelAlt, border: `1px solid ${S.border}` }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = S.borderHi }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = S.border }}
              >
                <p className="text-[10px] mb-1" style={{ color: S.textMute }}>{item.label}</p>
                <p className="text-base font-bold tabular-nums" style={{ color: S.text }}>{item.value}</p>
                <p className="text-[10px] mt-1" style={{ color: S.textFade }}>{item.sub}</p>
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  )
}
