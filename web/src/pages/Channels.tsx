import { useState, useEffect, useCallback } from 'react'
import {
  Bot, Plus, Radio, Power, RefreshCw,
  Trash2, ExternalLink, Loader2, Hash,
} from 'lucide-react'
import { wsApi, botApi } from '../lib/api'
import type { Bot as BotType, Workspace } from '../lib/api'
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

/* ─── BotCard ─── */
function BotCard({ bot, onAction, onDelete }: {
  bot: BotType
  onAction: (id: string, action: 'start' | 'stop' | 'restart') => void
  onDelete:  (id: string) => void
}) {
  const { t } = useI18n()
  const [hovered, setHovered] = useState(false)

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
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-[11px]" style={{ color: S.textMute }}>
            <Hash size={10} />{t('bot_info_channel')}
          </span>
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
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-[11px]" style={{ color: S.textMute }}>
            <Radio size={10} />{t('bot_info_broadcasts')}
          </span>
          <span className="text-[11px] tabular-nums" style={{ color: S.text }}>{bot.broadcastCount}</span>
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
  const [ws,      setWs]      = useState<Workspace | null>(null)
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
    wsApi.list()
      .then(d => {
        const w = d.workspaces[0] ?? null
        setWs(w)
        if (w) fetchBots(w)
        else setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [fetchBots])

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
