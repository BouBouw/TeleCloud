import { useState, useEffect, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import {
  Bot, Plus, Radio, Power, RefreshCw,
  Trash2, ExternalLink, Loader2, Hash, Pencil, Check, X, KeyRound,
} from 'lucide-react'
import { botApi } from '../lib/api'
import type { Bot as BotType, Workspace } from '../lib/api'
import { useWorkspaces } from '../store/workspaceStore'
import { useI18n } from '../i18n'

/* ─── Design tokens ─── */
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
  yellow:   '#facc15',
}

const inputCls = "w-full outline-none rounded px-3 py-2 text-xs"
const inputSty: React.CSSProperties = { background: S.input, color: S.text, border: `1px solid ${S.border}` }

/* ─── Status helpers ─── */
function statusStyle(s: string): React.CSSProperties {
  if (s === 'running') return { color: S.green,  background: 'rgba(74,222,128,0.08)',  border: `1px solid rgba(74,222,128,0.22)` }
  if (s === 'paused')  return { color: S.yellow, background: 'rgba(250,204,21,0.08)',  border: `1px solid rgba(250,204,21,0.22)` }
  return                       { color: S.red,   background: 'rgba(231,76,60,0.08)',   border: `1px solid rgba(231,76,60,0.22)`  }
}

/* ─── Telegram reaction emojis available to bots ─── */
const TG_REACTIONS = [
  '👍','👎','❤️','🔥','🥰','👏','😁','🤔','🤯','😱',
  '🤬','😢','🎉','🤩','💩','🙏','👌','🕊️','🤡','🥱',
  '🥴','😍','🐳','🌚','🌭','💯','🤣','⚡','🍌','🏆',
  '💔','🤨','😐','🍓','🍾','💋','😈','😴','😭','🤓',
  '👻','👀','🎃','😇','😂','🤷',
]

/* ─── BotCard ─── */
function BotCard({ bot, onAction, onDelete, onUpdate }: {
  bot: BotType
  onAction: (id: string, action: 'start' | 'stop' | 'restart') => void
  onDelete:  (id: string) => void
  onUpdate:  (id: string, data: { channelId?: string; reaction?: string | null; telegramToken?: string }) => Promise<void>
}) {
  const { t } = useI18n()
  const [hovered,       setHovered]       = useState(false)
  const [editingCh,     setEditingCh]     = useState(false)
  const [newChannelId,  setNewChannelId]  = useState(bot.channelId)
  const [savingCh,      setSavingCh]      = useState(false)
  const [editingToken,  setEditingToken]  = useState(false)
  const [newToken,      setNewToken]      = useState('')
  const [savingToken,   setSavingToken]   = useState(false)
  const [showReactions, setShowReactions] = useState(false)
  const [savingReact,   setSavingReact]   = useState(false)
  const reactPickerRef = useRef<HTMLDivElement>(null)
  const triggerRef     = useRef<HTMLButtonElement>(null)
  const [pickerRect,   setPickerRect]     = useState<{ top: number; right: number } | null>(null)

  // Close picker when clicking outside
  useEffect(() => {
    if (!showReactions) return
    const handler = (e: MouseEvent) => {
      if (
        reactPickerRef.current && !reactPickerRef.current.contains(e.target as Node) &&
        triggerRef.current     && !triggerRef.current.contains(e.target as Node)
      ) {
        setShowReactions(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showReactions])

  const openPicker = () => {
    if (triggerRef.current) {
      const r = triggerRef.current.getBoundingClientRect()
      setPickerRect({ top: r.top - 4, right: window.innerWidth - r.right })
    }
    setShowReactions(v => !v)
  }

  return (
    <div
      style={{
        background: S.panel,
        border: `1px solid ${hovered ? S.borderHi : S.border}`,
        borderRadius: 8,
        padding: '16px',
        transition: 'border-color 0.18s',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <div
          className="flex items-center justify-center rounded shrink-0"
          style={{ width: 36, height: 36, background: S.panelAlt, border: `1px solid ${S.border}` }}
        >
          <Bot size={16} style={{ color: S.accent }} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold truncate" style={{ color: S.text }}>{bot.name}</p>
          <p className="text-[10px] font-mono truncate" style={{ color: S.textFade }}>
            {bot.telegramToken.substring(0, 16)}…
          </p>
        </div>
        {/* status dot */}
        <span
          className="text-[10px] font-medium px-2 py-0.5 rounded-full flex items-center gap-1 shrink-0"
          style={statusStyle(bot.status)}
        >
          <span
            className="rounded-full shrink-0"
            style={{ width: 5, height: 5, background: 'currentColor' }}
          />
          {bot.status}
        </span>
      </div>

      {/* Info rows */}
      <div
        className="flex flex-col gap-2 py-3"
        style={{ borderTop: `1px solid ${S.border}`, borderBottom: `1px solid ${S.border}` }}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 text-[11px] shrink-0" style={{ color: S.textMute }}>
            <KeyRound size={10} /> Token
          </span>
          {editingToken ? (
            <form
              className="flex items-center gap-1 flex-1 min-w-0"
              onSubmit={async e => {
                e.preventDefault()
                if (!newToken.trim() || newToken.trim().length < 20) return
                setSavingToken(true)
                try { await onUpdate(bot.id, { telegramToken: newToken.trim() }) } finally {
                  setSavingToken(false); setEditingToken(false); setNewToken('')
                }
              }}
            >
              <input
                autoFocus
                type="password"
                value={newToken}
                onChange={e => setNewToken(e.target.value)}
                placeholder="Nouveau token…"
                className="flex-1 min-w-0 outline-none rounded px-1.5 py-0.5 text-[11px] font-mono"
                style={{ background: S.input, color: S.text, border: `1px solid ${S.accent}` }}
              />
              <button
                type="submit"
                disabled={savingToken || newToken.trim().length < 20}
                style={{ color: S.green, background: 'none', border: 'none', cursor: 'pointer', padding: 2 }}
              >
                {savingToken ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
              </button>
              <button
                type="button"
                onClick={() => { setEditingToken(false); setNewToken('') }}
                style={{ color: S.red, background: 'none', border: 'none', cursor: 'pointer', padding: 2 }}
              >
                <X size={11} />
              </button>
            </form>
          ) : (
            <span className="flex items-center gap-1 text-[11px] font-mono" style={{ color: S.textDim }}>
              {'•'.repeat(12)}…
              <button
                onClick={() => setEditingToken(true)}
                style={{ color: S.textFade, background: 'none', border: 'none', cursor: 'pointer', padding: 2 }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = S.accent }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = S.textFade }}
              >
                <Pencil size={9} />
              </button>
            </span>
          )}
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 text-[11px] shrink-0" style={{ color: S.textMute }}>
            <Hash size={10} />{t('bot_info_channel')}
          </span>
          {editingCh ? (
            <form
              className="flex items-center gap-1 flex-1 min-w-0"
              onSubmit={async e => {
                e.preventDefault()
                if (!newChannelId.trim()) return
                setSavingCh(true)
                try { await onUpdate(bot.id, { channelId: newChannelId.trim() }) } finally {
                  setSavingCh(false); setEditingCh(false)
                }
              }}
            >
              <input
                autoFocus
                value={newChannelId}
                onChange={e => setNewChannelId(e.target.value)}
                className="flex-1 min-w-0 outline-none rounded px-1.5 py-0.5 text-[11px] font-mono"
                style={{ background: S.input, color: S.text, border: `1px solid ${S.accent}` }}
              />
              <button
                type="submit"
                disabled={savingCh}
                style={{ color: S.green, background: 'none', border: 'none', cursor: 'pointer', padding: 2 }}
              >
                {savingCh ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
              </button>
              <button
                type="button"
                onClick={() => { setEditingCh(false); setNewChannelId(bot.channelId) }}
                style={{ color: S.red, background: 'none', border: 'none', cursor: 'pointer', padding: 2 }}
              >
                <X size={11} />
              </button>
            </form>
          ) : (
            <span className="flex items-center gap-1 text-[11px] font-mono" style={{ color: S.textDim }}>
              {bot.channelId}
              <a
                href={`https://t.me/${bot.channelId.replace('@','')}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: S.textFade }}
              >
                <ExternalLink size={9} />
              </a>
              <button
                onClick={() => { setNewChannelId(bot.channelId); setEditingCh(true) }}
                style={{ color: S.textFade, background: 'none', border: 'none', cursor: 'pointer', padding: 2 }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = S.accent }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = S.textFade }}
              >
                <Pencil size={9} />
              </button>
            </span>
          )}
        </div>
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-[11px]" style={{ color: S.textMute }}>
            <Radio size={10} />{t('bot_info_broadcasts')}
          </span>
          <span className="text-[11px] tabular-nums" style={{ color: S.text }}>{bot.broadcastCount}</span>
        </div>

        {/* Reaction row */}
        <div className="flex items-center justify-between" style={{ position: 'relative' }}>
          <span className="flex items-center gap-1.5 text-[11px]" style={{ color: S.textMute }}>
            <span style={{ fontSize: 11 }}>✨</span> Réaction auto
          </span>

          {/* Trigger button */}
          <button
            ref={triggerRef}
            onClick={openPicker}
            disabled={savingReact}
            className="flex items-center gap-1.5 rounded px-2 py-1 text-xs font-medium transition-all disabled:opacity-40"
            style={{
              background:     bot.reaction ? `${S.accent}15` : S.input,
              color:          bot.reaction ? S.accent : S.textMute,
              border:         `1px solid ${bot.reaction ? S.accent + '35' : S.border}`,
              cursor:         'pointer',
              minWidth:       54,
              justifyContent: 'center',
            }}
          >
            {savingReact
              ? <Loader2 size={11} className="animate-spin" />
              : bot.reaction
                ? <span style={{ fontSize: 16, lineHeight: 1 }}>{bot.reaction}</span>
                : <span style={{ fontSize: 10, letterSpacing: '0.02em' }}>OFF</span>}
          </button>

          {/* Picker portal — renders into document.body to escape any overflow:hidden */}
          {showReactions && pickerRect && createPortal(
            <div
              ref={reactPickerRef}
              style={{
                position:  'fixed',
                right:      pickerRect.right,
                top:        pickerRect.top,
                transform: 'translateY(-100%)',
                zIndex:     9999,
                background: '#1c1c1c',
                border:     `1px solid ${S.borderHi}`,
                borderRadius: 12,
                boxShadow:  '0 12px 40px rgba(0,0,0,0.8)',
                padding:    12,
                width:      234,
              }}
            >
              <p style={{ fontSize: 9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: S.textMute, marginBottom: 8 }}>
                Réaction Telegram
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 3 }}>
                {/* OFF cell */}
                <button
                  onClick={async () => {
                    setShowReactions(false); setSavingReact(true)
                    try { await onUpdate(bot.id, { reaction: null }) } finally { setSavingReact(false) }
                  }}
                  title="Désactiver"
                  style={{
                    height: 28, width: '100%',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    borderRadius: 6, cursor: 'pointer', fontSize: 9, fontWeight: 700,
                    background: !bot.reaction ? `${S.accent}22` : S.input,
                    color:      !bot.reaction ?  S.accent        : S.textFade,
                    border:     `1px solid ${!bot.reaction ? S.accent + '55' : S.border}`,
                  }}
                  onMouseEnter={e => { if (bot.reaction) (e.currentTarget as HTMLElement).style.background = S.hover }}
                  onMouseLeave={e => { if (bot.reaction) (e.currentTarget as HTMLElement).style.background = S.input }}
                >OFF</button>

                {TG_REACTIONS.map(emoji => {
                  const active = bot.reaction === emoji
                  return (
                    <button
                      key={emoji}
                      onClick={async () => {
                        setShowReactions(false); setSavingReact(true)
                        try { await onUpdate(bot.id, { reaction: emoji }) } finally { setSavingReact(false) }
                      }}
                      title={emoji}
                      style={{
                        height: 28, width: '100%',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        borderRadius: 6, cursor: 'pointer', fontSize: 17, lineHeight: 1,
                        background: active ? `${S.accent}22` : 'transparent',
                        border:     `1px solid ${active ? S.accent + '55' : 'transparent'}`,
                        transition: 'background 0.1s',
                      }}
                      onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.background = S.hover }}
                      onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.background = 'transparent' }}
                    >{emoji}</button>
                  )
                })}
              </div>
            </div>,
            document.body,
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-end gap-1 mt-3">
        <button
          onClick={() => onAction(bot.id, 'restart')}
          className="p-1.5 rounded transition-colors"
          style={{ color: S.textFade, background: 'transparent', border: 'none', cursor: 'pointer' }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = S.yellow }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = S.textFade }}
          title={t('btn_title_restart')}
        >
          <RefreshCw size={13} />
        </button>
        <button
          onClick={() => onAction(bot.id, bot.status === 'running' ? 'stop' : 'start')}
          className="p-1.5 rounded transition-colors"
          style={{ color: S.textFade, background: 'transparent', border: 'none', cursor: 'pointer' }}
          onMouseEnter={e => {
            (e.currentTarget as HTMLElement).style.color = bot.status === 'running' ? S.red : S.green
          }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = S.textFade }}
          title={bot.status === 'running' ? t('btn_title_stop') : t('btn_title_start')}
        >
          <Power size={13} />
        </button>
        <button
          onClick={() => onDelete(bot.id)}
          className="p-1.5 rounded transition-colors"
          style={{ color: S.textFade, background: 'transparent', border: 'none', cursor: 'pointer' }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = S.red }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = S.textFade }}
          title={t('btn_title_delete')}
        >
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  )
}

/* ─── Deploy Modal ─── */
function DeployModal({ wsId, onClose, onDeployed }: {
  wsId: string; onClose: () => void; onDeployed: () => void
}) {
  const { t } = useI18n()
  const [newBot,    setNewBot]    = useState({ name: '', token: '', channelId: '' })
  const [adding,    setAdding]    = useState(false)
  const [addError,  setAddError]  = useState('')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    setAdding(true); setAddError('')
    try {
      await botApi.create(wsId, { name: newBot.name, telegramToken: newBot.token, channelId: newBot.channelId })
      onDeployed(); onClose()
    } catch (err) {
      setAddError(String(err).replace('Error: ', ''))
    } finally {
      setAdding(false)
    }
  }

  const Field = ({ label, value, setter, placeholder, type = 'text' }: {
    label: string; value: string; setter: (v: string) => void; placeholder?: string; type?: string
  }) => (
    <div>
      <div className="text-[10px] uppercase tracking-wide mb-1.5" style={{ color: S.textMute }}>{label}</div>
      <input
        required
        type={type}
        value={value}
        onChange={e => setter(e.target.value)}
        placeholder={placeholder}
        className={inputCls}
        style={{ ...inputSty, fontFamily: type === 'password' || label.includes('Token') || label.includes('Channel') ? 'monospace' : 'inherit' }}
      />
    </div>
  )

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.8)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="w-full max-w-sm"
        style={{ background: S.panel, border: `1px solid ${S.borderHi}`, borderRadius: 10 }}
      >
        {/* Modal header */}
        <div
          className="flex items-center gap-2.5 px-4 py-3 border-b"
          style={{ borderColor: S.border }}
        >
          <Bot size={14} style={{ color: S.accent }} />
          <div>
            <p className="text-xs font-semibold" style={{ color: S.text }}>{t('deploy_modal_title')}</p>
            <p className="text-[10px]" style={{ color: S.textFade }}>{t('deploy_modal_subtitle')}</p>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleAdd} className="flex flex-col gap-3 p-4">
          {addError && (
            <div
              className="px-3 py-2 rounded text-xs"
              style={{ background: 'rgba(231,76,60,0.1)', border: `1px solid rgba(231,76,60,0.25)`, color: S.red }}
            >
              {addError}
            </div>
          )}
          <Field
            label={t('field_bot_name')}
            value={newBot.name}
            setter={v => setNewBot(b => ({ ...b, name: v }))}
            placeholder={t('placeholder_bot_name')}
          />
          <Field
            label={t('field_bot_token')}
            type="password"
            value={newBot.token}
            setter={v => setNewBot(b => ({ ...b, token: v }))}
            placeholder={t('placeholder_bot_token')}
          />
          <Field
            label={t('field_channel_id')}
            value={newBot.channelId}
            setter={v => setNewBot(b => ({ ...b, channelId: v }))}
            placeholder={t('placeholder_channel_id')}
          />

          <div className="flex gap-2 mt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2 rounded text-xs"
              style={{ background: S.input, color: S.textMute, border: `1px solid ${S.border}`, cursor: 'pointer' }}
            >
              {t('btn_cancel')}
            </button>
            <button
              type="submit"
              disabled={adding}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded text-xs font-semibold disabled:opacity-60"
              style={{ background: S.accent, color: '#000', border: 'none', cursor: adding ? 'default' : 'pointer' }}
            >
              {adding ? <Loader2 size={12} className="animate-spin" /> : <Bot size={12} />}
              {t('btn_deploy')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

/* ─── Channels Page ─── */
export default function Channels() {
  const { workspace: ws } = useWorkspaces()
  const [bots,    setBots]    = useState<BotType[]>([])
  const [loading, setLoading] = useState(true)
  const [modal,   setModal]   = useState(false)

  const { t } = useI18n()
  const fetchBots = useCallback(async (workspace: Workspace) => {
    setLoading(true)
    try {
      const data = await botApi.list(workspace.id)
      setBots(data.bots)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!ws) return
    fetchBots(ws)
  }, [ws, fetchBots])

  const handleAction = async (botId: string, action: 'start' | 'stop' | 'restart') => {
    if (!ws) return
    await botApi.action(ws.id, botId, action).catch(() => {})
    fetchBots(ws)
  }

  const handleDelete = async (botId: string) => {
    if (!ws || !confirm(t('confirm_delete_bot'))) return
    await botApi.delete(ws.id, botId).catch(() => {})
    fetchBots(ws)
  }

  const handleUpdate = async (botId: string, data: { channelId?: string; reaction?: string | null; telegramToken?: string }) => {
    if (!ws) return
    await botApi.update(ws.id, botId, data)
    fetchBots(ws)
  }

  const running = bots.filter(b => b.status === 'running').length

  return (
    <div className="flex flex-col h-full fade-in" style={{ background: S.bg, color: S.text }}>

      {modal && ws && (
        <DeployModal
          wsId={ws.id}
          onClose={() => setModal(false)}
          onDeployed={() => fetchBots(ws)}
        />
      )}

      {/* ── Top bar ── */}
      <div
        className="flex items-center gap-3 px-4 border-b shrink-0"
        style={{ borderColor: S.border, height: 36 }}
      >
        <Bot size={13} style={{ color: S.accent }} />
        <span className="text-sm font-semibold" style={{ color: S.text }}>{t('page_title_channels')}</span>
        {!loading && (
          <span className="text-[10px]" style={{ color: S.textMute }}>
            {bots.length} bot{bots.length !== 1 ? 's' : ''}
            {running > 0 && ` · `}
            {running > 0 && <span style={{ color: S.green }}>{running} actif{running !== 1 ? 's' : ''}</span>}
          </span>
        )}
        <div className="ml-auto">
          <button
            onClick={() => setModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold"
            style={{ background: S.accent, color: '#000', border: 'none', cursor: 'pointer' }}
          >
            <Plus size={12} />{t('btn_deploy')}
          </button>
        </div>
      </div>

      {/* ── Content ── */}
      <div className="flex-1 overflow-y-auto p-3 sm:p-5">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-20" style={{ color: S.textMute }}>
            <Loader2 size={16} className="animate-spin" style={{ color: S.accent }} />
            <span className="text-xs">{t('loading')}</span>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {bots.map(bot => (
              <BotCard
                key={bot.id}
                bot={bot}
                onAction={handleAction}
                onDelete={handleDelete}
                onUpdate={handleUpdate}
              />
            ))}

            {/* Add ghost card */}
            <button
              onClick={() => setModal(true)}
              className="flex flex-col items-center justify-center gap-3 rounded transition-colors"
              style={{
                minHeight: 168,
                background: 'transparent',
                border: `2px dashed ${S.border}`,
                borderRadius: 8,
                color: S.textFade,
                cursor: 'pointer',
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLElement).style.borderColor = S.accent + '55'
                ;(e.currentTarget as HTMLElement).style.color = S.accent
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLElement).style.borderColor = S.border
                ;(e.currentTarget as HTMLElement).style.color = S.textFade
              }}
            >
              <div
                className="flex items-center justify-center rounded"
                style={{ width: 40, height: 40, background: S.panel, border: `1px solid ${S.border}` }}
              >
                <Plus size={18} />
              </div>
              <div className="text-center">
                <p className="text-xs font-medium">{t('ghost_card_title')}</p>
                <p className="text-[10px] mt-0.5 opacity-60">{t('ghost_card_subtitle')}</p>
              </div>
            </button>
          </div>
        )}

        {/* Empty state (no bots, not loading) */}
        {!loading && bots.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-3 py-16">
            <div
              className="flex items-center justify-center rounded"
              style={{ width: 56, height: 56, background: S.panel, border: `1px solid ${S.border}` }}
            >
              <Bot size={22} style={{ color: S.textFade }} />
            </div>
            <p className="text-xs" style={{ color: S.textMute }}>{t('empty_no_bots_title')}</p>
            <p className="text-[10px]" style={{ color: S.textFade }}>
              {t('empty_no_bots_desc')}
            </p>
            <button
              onClick={() => setModal(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold mt-1"
              style={{ background: S.accent, color: '#000', border: 'none', cursor: 'pointer' }}
            >
              <Plus size={11} />{t('empty_btn_deploy_first')}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
