import { useState, useEffect, useRef, useCallback } from "react"
import {
  Users, Plus, X, Search, Trash2, Loader2,
  Music2, Sliders, Clapperboard, Radio, Crown,
} from "lucide-react"
import { memberApi } from "../lib/api"
import type { WorkspaceMember, MemberUser, AllPermKey } from "../lib/api"
import { useWorkspaces } from '../store/workspaceStore'
import { useAuth } from "../hooks/useAuth"

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
}

type ParentKey = 'canLibrary' | 'canStudio' | 'canMontage' | 'canChannels'
interface SubPerm   { key: AllPermKey; label: string }
interface PermGroup { key: ParentKey; label: string; icon: React.ReactNode; subs: SubPerm[] }

const PERMISSION_GROUPS: PermGroup[] = [
  {
    key: 'canLibrary', label: 'Bibliotheque', icon: <Music2 size={12} />,
    subs: [
      { key: 'libRead',   label: 'Voir les pistes' },
      { key: 'libWrite',  label: 'Ajouter / modifier' },
      { key: 'libDelete', label: 'Supprimer des pistes' },
      { key: 'libSend',   label: 'Envoyer via Telegram' },
    ],
  },
  {
    key: 'canStudio', label: 'Studio', icon: <Sliders size={12} />,
    subs: [],
  },
  {
    key: 'canMontage', label: 'Montages', icon: <Clapperboard size={12} />,
    subs: [
      { key: 'montageView',   label: 'Voir les projets' },
      { key: 'montageEdit',   label: 'Creer / modifier' },
      { key: 'montageDelete', label: 'Supprimer des projets' },
    ],
  },
  {
    key: 'canChannels', label: 'Canaux', icon: <Radio size={12} />,
    subs: [
      { key: 'chanView',   label: 'Voir les canaux' },
      { key: 'chanManage', label: 'Gerer les bots' },
      { key: 'chanDelete', label: 'Supprimer des bots' },
    ],
  },
]

const DEFAULT_PERMS: Record<AllPermKey, boolean> = {
  canLibrary: true,  canStudio: true,   canMontage: true,    canChannels: false,
  libRead:    true,  libWrite:  true,   libDelete:  false,   libSend:    true,
  montageView: true, montageEdit: true, montageDelete: false,
  chanView:   false, chanManage: false, chanDelete:   false,
}

const OWNER_PERMS: Record<AllPermKey, boolean> = Object.fromEntries(
  Object.keys(DEFAULT_PERMS).map(k => [k, true])
) as Record<AllPermKey, boolean>

function Checkbox({ checked, faded = false }: { checked: boolean; faded?: boolean }) {
  return (
    <div className="flex items-center justify-center rounded shrink-0 transition-all"
      style={{
        width: 13, height: 13,
        background: checked && !faded ? S.accent : 'transparent',
        border: `1.5px solid ${checked && !faded ? S.accent : faded ? S.textFade : S.textMute}`,
      }}>
      {checked && (
        <svg width="7" height="6" viewBox="0 0 7 6" fill="none">
          <path d="M1 3L2.8 5L6 1" stroke={faded ? '#555' : '#000'} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </div>
  )
}

function PermCard({ group, values, onChange, readonly }: {
  group:    PermGroup
  values:   Record<AllPermKey, boolean>
  onChange: (key: AllPermKey, val: boolean) => void
  readonly: boolean
}) {
  const parentOn = values[group.key]
  return (
    <div className="rounded overflow-hidden flex flex-col"
      style={{ border: `1px solid ${parentOn ? S.accent + '40' : S.border}` }}>
      <button type="button" disabled={readonly} onClick={() => !readonly && onChange(group.key, !parentOn)}
        className="flex items-center gap-2 px-3 py-2.5 w-full"
        style={{ background: parentOn ? `${S.accent}10` : S.input, cursor: readonly ? 'default' : 'pointer' }}
        onMouseEnter={e => { if (!readonly) (e.currentTarget as HTMLElement).style.background = parentOn ? `${S.accent}18` : S.hover }}
        onMouseLeave={e => { if (!readonly) (e.currentTarget as HTMLElement).style.background = parentOn ? `${S.accent}10` : S.input }}>
        <Checkbox checked={parentOn} faded={readonly} />
        <span style={{ color: parentOn ? S.accent : S.textFade, display: 'flex' }}>{group.icon}</span>
        <span className="text-xs font-semibold" style={{ color: parentOn ? S.accent : S.textMute }}>{group.label}</span>
      </button>
      {group.subs.map(sub => {
        const subOn    = values[sub.key]
        const canClick = !readonly && parentOn
        return (
          <button key={sub.key} type="button" disabled={!canClick} onClick={() => canClick && onChange(sub.key, !subOn)}
            className="flex items-center gap-2 px-3 py-1.5"
            style={{ background: 'transparent', cursor: canClick ? 'pointer' : 'default', opacity: !parentOn ? 0.3 : 1, borderTop: `1px solid ${S.border}` }}
            onMouseEnter={e => { if (canClick) (e.currentTarget as HTMLElement).style.background = S.hover }}
            onMouseLeave={e => { if (canClick) (e.currentTarget as HTMLElement).style.background = 'transparent' }}>
            <Checkbox checked={subOn} faded={!parentOn || readonly} />
            <span className="text-[11px]" style={{ color: subOn && parentOn ? S.textDim : S.textFade }}>{sub.label}</span>
          </button>
        )
      })}
      {group.subs.length === 0 && (
        <div className="px-3 py-1.5 text-[10px]"
          style={{ borderTop: `1px solid ${S.border}`, color: S.textFade, opacity: parentOn ? 1 : 0.4 }}>
          Acces complet au studio
        </div>
      )}
    </div>
  )
}

function Avatar({ name, size = 36 }: { name: string; size?: number }) {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffff
  const hue = h % 360
  return (
    <div className="flex items-center justify-center rounded-full shrink-0 font-semibold select-none"
      style={{ width: size, height: size, fontSize: size * 0.35, background: `hsl(${hue},45%,18%)`, color: `hsl(${hue},65%,65%)`, border: `1px solid hsl(${hue},35%,28%)` }}>
      {name.split(' ').map((w: string) => w[0]).join('').toUpperCase().slice(0, 2)}
    </div>
  )
}

function memberValues(m: WorkspaceMember): Record<AllPermKey, boolean> {
  return {
    canLibrary: m.canLibrary, canStudio: m.canStudio, canMontage: m.canMontage, canChannels: m.canChannels,
    libRead: m.libRead, libWrite: m.libWrite, libDelete: m.libDelete, libSend: m.libSend,
    montageView: m.montageView, montageEdit: m.montageEdit, montageDelete: m.montageDelete,
    chanView: m.chanView, chanManage: m.chanManage, chanDelete: m.chanDelete,
  }
}

export default function Members() {
  const { user } = useAuth()
  const { workspace: ws } = useWorkspaces()
  const [members,       setMembers]       = useState<WorkspaceMember[]>([])
  const [loading,       setLoading]       = useState(true)
  const [searchQ,       setSearchQ]       = useState('')
  const [searchResults, setSearchResults] = useState<MemberUser[]>([])
  const [searching,     setSearching]     = useState(false)
  const [adding,        setAdding]        = useState<string | null>(null)
  const [removing,      setRemoving]      = useState<string | null>(null)
  const [showAdd,       setShowAdd]       = useState(false)
  const [addError,      setAddError]      = useState('')
  const [newPerms,      setNewPerms]      = useState<Record<AllPermKey, boolean>>({ ...DEFAULT_PERMS })
  const searchRef   = useRef<HTMLDivElement>(null)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isOwner = !!(ws && user && ws.ownerId === user.id)

  const loadMembers = useCallback(async () => {
    if (!ws) return
    setLoading(true)
    try { const d = await memberApi.list(ws.id); setMembers(d.members) }
    catch {} finally { setLoading(false) }
  }, [ws])

  useEffect(() => { loadMembers() }, [loadMembers])

  useEffect(() => {
    if (!ws || searchQ.length < 2) { setSearchResults([]); return }
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(async () => {
      setSearching(true)
      try { const d = await memberApi.searchUsers(ws.id, searchQ); setSearchResults(d.users) }
      catch {} finally { setSearching(false) }
    }, 300)
  }, [searchQ, ws])

  useEffect(() => {
    const h = (e: MouseEvent) => { if (searchRef.current && !searchRef.current.contains(e.target as Node)) setSearchResults([]) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  const handleAdd = async (target: MemberUser) => {
    if (!ws) return
    setAdding(target.id); setAddError('')
    try {
      const d = await memberApi.add(ws.id, target.email, newPerms)
      setMembers(prev => [...prev, d.member])
      setSearchQ(''); setSearchResults([])
    } catch (err) { setAddError(String(err).replace('Error: ', '')) }
    finally { setAdding(null) }
  }

  const handleUpdatePerm = async (memberId: string, key: AllPermKey, value: boolean) => {
    if (!ws) return
    setMembers(prev => prev.map(m => m.id === memberId ? { ...m, [key]: value } : m))
    try { await memberApi.updatePerms(ws.id, memberId, { [key]: value }) }
    catch { setMembers(prev => prev.map(m => m.id === memberId ? { ...m, [key]: !value } : m)) }
  }

  const handleRemove = async (memberId: string) => {
    if (!ws || removing) return
    setRemoving(memberId)
    try { await memberApi.remove(ws.id, memberId); setMembers(prev => prev.filter(m => m.id !== memberId)) }
    catch {} finally { setRemoving(null) }
  }

  return (
    <div className="flex flex-col h-full fade-in" style={{ background: S.bg, color: S.text }}>
      <div className="flex items-center gap-3 px-5 shrink-0 border-b" style={{ height: 48, borderColor: S.border, background: S.panelAlt }}>
        <Users size={15} style={{ color: S.accent }} />
        <div className="flex-1 min-w-0">
          <span className="text-sm font-semibold" style={{ color: S.text }}>Membres</span>
          {ws && <span className="ml-2 text-[10px]" style={{ color: S.textMute }}>{ws.name} · {members.length} membre{members.length !== 1 ? 's' : ''}</span>}
        </div>
        {isOwner && (
          <button onClick={() => { setShowAdd(v => !v); setAddError(''); setSearchQ(''); setSearchResults([]) }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold"
            style={{ background: showAdd ? `${S.accent}20` : S.accent, color: showAdd ? S.accent : '#000', border: showAdd ? `1px solid ${S.accent}50` : 'none' }}>
            {showAdd ? <X size={12} /> : <Plus size={12} />}
            {showAdd ? 'Annuler' : 'Ajouter un membre'}
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="p-4 md:p-6 flex flex-col gap-4 max-w-4xl mx-auto w-full">

          {isOwner && showAdd && (
            <div className="rounded-lg p-4 flex flex-col gap-4" style={{ background: S.panel, border: `1px solid ${S.borderHi}` }}>
              <div>
                <div className="text-xs font-semibold mb-0.5" style={{ color: S.text }}>Ajouter un membre</div>
                <p className="text-[11px]" style={{ color: S.textMute }}>Le membre doit avoir un compte sur la plateforme.</p>
              </div>
              <div ref={searchRef} className="relative">
                <div className="flex items-center gap-2 rounded px-3 py-2.5" style={{ background: S.input, border: `1px solid ${S.border}` }}>
                  {searching ? <Loader2 size={13} className="animate-spin shrink-0" style={{ color: S.textMute }} /> : <Search size={13} style={{ color: S.textDim, flexShrink: 0 }} />}
                  <input type="text" placeholder="Rechercher par email ou nom..." value={searchQ} onChange={e => setSearchQ(e.target.value)}
                    className="bg-transparent text-xs outline-none flex-1" style={{ color: S.text }} autoComplete="off" />
                  {searchQ && <button onClick={() => { setSearchQ(''); setSearchResults([]) }} style={{ color: S.textFade }}><X size={10} /></button>}
                </div>
                {searchResults.length > 0 && (
                  <div className="absolute top-full left-0 right-0 mt-1 rounded overflow-hidden z-20"
                    style={{ background: S.panel, border: `1px solid ${S.border}`, boxShadow: '0 8px 24px rgba(0,0,0,0.5)' }}>
                    {searchResults.map(u => (
                      <button key={u.id} onClick={() => handleAdd(u)} disabled={adding === u.id}
                        className="w-full flex items-center gap-3 px-3 py-2.5 disabled:opacity-50" style={{ borderBottom: `1px solid ${S.border}` }}
                        onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = S.hover}
                        onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = ''}>
                        <Avatar name={u.displayName} size={30} />
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-medium truncate" style={{ color: S.text }}>{u.displayName}</div>
                          <div className="text-[10px] truncate" style={{ color: S.textMute }}>{u.email}</div>
                        </div>
                        {adding === u.id ? <Loader2 size={12} className="animate-spin" style={{ color: S.accent }} />
                          : <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: `${S.accent}20`, color: S.accent }}>Ajouter</span>}
                      </button>
                    ))}
                  </div>
                )}
                {searchQ.length >= 2 && !searching && searchResults.length === 0 && (
                  <div className="absolute top-full left-0 right-0 mt-1 rounded px-3 py-3 text-xs z-20"
                    style={{ background: S.panel, border: `1px solid ${S.border}`, color: S.textMute }}>
                    Aucun utilisateur trouve pour {searchQ}
                  </div>
                )}
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider mb-2" style={{ color: S.textMute }}>Permissions par defaut</div>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
                  {PERMISSION_GROUPS.map(g => (
                    <PermCard key={g.key} group={g} values={newPerms} readonly={false}
                      onChange={(key, val) => setNewPerms(p => ({ ...p, [key]: val }))} />
                  ))}
                </div>
              </div>
              {addError && (
                <div className="text-[11px] px-2 py-1.5 rounded"
                  style={{ background: 'rgba(231,76,60,0.1)', border: '1px solid rgba(231,76,60,0.3)', color: '#e74c3c' }}>
                  {addError}
                </div>
              )}
            </div>
          )}

          <div className="flex flex-col gap-3">
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-16" style={{ color: S.textMute }}>
                <Loader2 size={16} className="animate-spin" style={{ color: S.accent }} />
                <span className="text-xs">Chargement...</span>
              </div>
            ) : members.length === 0 ? (
              <div className="flex flex-col items-center py-16 gap-2" style={{ color: S.textMute }}>
                <Users size={28} style={{ color: S.textFade }} />
                <p className="text-xs">Aucun membre pour l instant</p>
              </div>
            ) : members.map(member => {
              const isMe     = member.user.id === user?.id
              const ownerRow = member.role === 'OWNER'
              const canEdit  = isOwner && !ownerRow
              const vals     = ownerRow ? OWNER_PERMS : memberValues(member)
              return (
                <div key={member.id} className="rounded-lg p-4 flex flex-col gap-4"
                  style={{ background: S.panel, border: `1px solid ${isMe ? S.accent + '20' : S.border}` }}>
                  <div className="flex items-center gap-3">
                    <Avatar name={member.user.displayName} size={38} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium" style={{ color: S.text }}>{member.user.displayName}</span>
                        {isMe && <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: `${S.accent}18`, color: S.accent }}>vous</span>}
                      </div>
                      <div className="text-[11px]" style={{ color: S.textMute }}>{member.user.email}</div>
                    </div>
                    {ownerRow ? (
                      <div className="flex items-center gap-1.5 px-2.5 py-1 rounded text-[10px] font-semibold shrink-0"
                        style={{ background: `${S.accent}14`, color: S.accent, border: `1px solid ${S.accent}30` }}>
                        <Crown size={10} />Proprietaire
                      </div>
                    ) : canEdit ? (
                      <button onClick={() => handleRemove(member.id)} disabled={removing === member.id}
                        className="flex items-center justify-center p-1.5 rounded disabled:opacity-40 shrink-0"
                        style={{ color: S.textMute }} title="Retirer ce membre"
                        onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = S.red}
                        onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = S.textMute}>
                        {removing === member.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                      </button>
                    ) : null}
                  </div>
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
                    {PERMISSION_GROUPS.map(g => (
                      <PermCard key={g.key} group={g} values={vals} readonly={!canEdit}
                        onChange={(key, val) => handleUpdatePerm(member.id, key, val)} />
                    ))}
                  </div>
                </div>
              )
            })}
          </div>

          {!isOwner && !loading && (
            <div className="rounded px-3 py-2.5 text-[11px]"
              style={{ background: `${S.accent}08`, border: `1px solid ${S.accent}1a`, color: S.textDim }}>
              Seul le proprietaire du workspace peut gerer les membres et les permissions.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}