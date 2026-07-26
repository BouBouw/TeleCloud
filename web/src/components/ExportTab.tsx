import { useState, useEffect, useCallback } from 'react'
import {
  KeyRound, Plus, Trash2, Copy, Check, Eye, EyeOff, Loader2, ShieldAlert,
  FileJson, FileSpreadsheet, FileArchive, Download, RefreshCw, Terminal, X,
} from 'lucide-react'
import { apiKeyApi } from '../lib/api'
import type { ApiKey, ExportIdentity, ExportOptions } from '../lib/api'
import { useWorkspaces } from '../store/workspaceStore'

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
  input:    '#0a0a0a',
  red:      '#e74c3c',
  green:    '#4ade80',
}

const EXPIRY_CHOICES = [
  { value: '',    label: 'Jamais' },
  { value: '30',  label: '30 jours' },
  { value: '90',  label: '90 jours' },
  { value: '365', label: '1 an' },
]

function fmtDate(iso?: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('fr', { day: '2-digit', month: '2-digit', year: '2-digit' })
}

function fmtDateTime(iso?: string | null) {
  if (!iso) return 'Jamais utilisée'
  return new Date(iso).toLocaleString('fr', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

/** Small copy-to-clipboard button that flips to a checkmark for a moment. */
function CopyBtn({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch { /* clipboard blocked — nothing useful to do */ }
  }
  return (
    <button
      onClick={copy}
      className="flex items-center gap-1 px-2 py-1 rounded text-[10px] shrink-0"
      style={{
        background: copied ? 'rgba(74,222,128,0.12)' : S.input,
        color: copied ? S.green : S.textDim,
        border: `1px solid ${copied ? 'rgba(74,222,128,0.3)' : S.border}`,
      }}
    >
      {copied ? <Check size={10} /> : <Copy size={10} />}
      {label ?? (copied ? 'Copié' : 'Copier')}
    </button>
  )
}

function Card({ title, icon, desc, children }: {
  title: string; icon: React.ReactNode; desc?: string; children: React.ReactNode
}) {
  return (
    <div className="rounded-lg" style={{ background: S.panel, border: `1px solid ${S.border}` }}>
      <div className="flex items-start gap-2 px-4 py-3 border-b" style={{ borderColor: S.border }}>
        <span style={{ color: S.accent, marginTop: 1 }}>{icon}</span>
        <div>
          <div className="text-xs font-semibold" style={{ color: S.text }}>{title}</div>
          {desc && <div className="text-[10px] mt-0.5 leading-relaxed" style={{ color: S.textMute }}>{desc}</div>}
        </div>
      </div>
      <div className="p-4">{children}</div>
    </div>
  )
}

function Code({ children }: { children: string }) {
  return (
    <div className="relative group">
      <pre
        className="text-[10px] leading-relaxed rounded p-3 overflow-x-auto"
        style={{ background: S.input, border: `1px solid ${S.border}`, color: S.textDim, fontFamily: 'ui-monospace, monospace' }}
      >{children}</pre>
      <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <CopyBtn value={children} />
      </div>
    </div>
  )
}

interface Props { workspaceId: string }

/** Expiry is resolved once at load time so rendering stays pure. */
interface KeyRow extends ApiKey { expired: boolean }

export default function ExportTab({ workspaceId }: Props) {
  const { workspaces } = useWorkspaces()

  // ── Key management ────────────────────────────────────────────────────────
  const [keys,     setKeys]     = useState<KeyRow[]>([])
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [name,     setName]     = useState('')
  const [scopeWs,  setScopeWs]  = useState('')
  const [expiry,   setExpiry]   = useState('')
  const [creating, setCreating] = useState(false)
  const [fresh,    setFresh]    = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)

  // ── Export panel ──────────────────────────────────────────────────────────
  const [secret,     setSecret]     = useState('')
  const [showSecret, setShowSecret] = useState(false)
  const [identity,   setIdentity]   = useState<ExportIdentity | null>(null)
  const [idError,    setIdError]    = useState('')
  const [checking,   setChecking]   = useState(false)
  const [withAudio,  setWithAudio]  = useState(true)
  const [withCovers, setWithCovers] = useState(true)
  // null = follow the workspace currently selected in the app
  const [expWsPick,  setExpWsPick]  = useState<string | null>(null)
  const expWs = expWsPick ?? workspaceId

  const loadKeys = useCallback(async () => {
    try {
      const data = await apiKeyApi.list()
      const now = Date.now()
      setKeys(data.keys.map(k => ({
        ...k,
        expired: k.expiresAt ? new Date(k.expiresAt).getTime() < now : false,
      })))
      setError('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Chargement impossible')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadKeys() }, [loadKeys])

  const checkKey = useCallback(async (raw: string) => {
    if (!raw.trim()) { setIdentity(null); setIdError(''); return }
    setChecking(true)
    try {
      setIdentity(await apiKeyApi.identity(raw.trim()))
      setIdError('')
    } catch (e) {
      setIdentity(null)
      setIdError(e instanceof Error ? e.message : 'Clé invalide')
    } finally {
      setChecking(false)
    }
  }, [])

  const handleCreate = async () => {
    setCreating(true)
    try {
      const { secret: raw } = await apiKeyApi.create({
        name: name.trim() || undefined,
        workspaceId: scopeWs || null,
        expiresInDays: expiry ? Number(expiry) : null,
      })
      setFresh(raw)
      setSecret(raw)
      setFormOpen(false)
      setName(''); setScopeWs(''); setExpiry('')
      await loadKeys()
      await checkKey(raw)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Création impossible')
    } finally {
      setCreating(false)
    }
  }

  const handleDelete = async (id: string) => {
    setDeleting(id)
    try {
      await apiKeyApi.delete(id)
      setKeys(ks => ks.filter(k => k.id !== id))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Suppression impossible')
    } finally {
      setDeleting(null)
    }
  }

  const opts: ExportOptions = {
    workspaceId: expWs || undefined,
    includeAudio: withAudio,
    includeCovers: withCovers,
  }

  const download = (url: string) => {
    const a = document.createElement('a')
    a.href = url
    a.rel = 'noopener'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }

  const ready = Boolean(secret.trim()) && Boolean(identity)
  const origin = window.location.origin
  const keyForDocs = secret.trim() || '$VIBOT_KEY'
  const wsQuery = expWs ? `&workspaceId=${expWs}` : ''

  const btn = (enabled: boolean): React.CSSProperties => ({
    background: enabled ? S.input : 'transparent',
    border: `1px solid ${enabled ? S.borderHi : S.border}`,
    color: enabled ? S.text : S.textMute,
    opacity: enabled ? 1 : 0.5,
    cursor: enabled ? 'pointer' : 'not-allowed',
  })

  return (
    <div className="flex flex-col gap-4 p-4 max-w-4xl mx-auto w-full">

      {error && (
        <div className="flex items-center gap-2 px-3 py-2 rounded text-[11px]"
          style={{ background: 'rgba(231,76,60,0.1)', border: '1px solid rgba(231,76,60,0.3)', color: S.red }}>
          <ShieldAlert size={12} />{error}
          <button onClick={() => setError('')} className="ml-auto"><X size={12} /></button>
        </div>
      )}

      {/* ── Freshly generated secret — shown once ─────────────────────────── */}
      {fresh && (
        <div className="rounded-lg p-4"
          style={{ background: 'rgba(240,168,48,0.07)', border: `1px solid rgba(240,168,48,0.35)` }}>
          <div className="flex items-center gap-2 mb-2">
            <KeyRound size={13} style={{ color: S.accent }} />
            <span className="text-xs font-semibold" style={{ color: S.accent }}>Ta nouvelle clé API</span>
          </div>
          <p className="text-[10px] mb-3 leading-relaxed" style={{ color: S.textDim }}>
            Copie-la maintenant : elle n'est stockée que sous forme hachée et ne sera plus jamais réaffichée.
            Si tu la perds, supprime la clé et génères-en une autre.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 px-3 py-2 rounded text-[11px] overflow-x-auto whitespace-nowrap"
              style={{ background: S.input, border: `1px solid ${S.border}`, color: S.text, fontFamily: 'ui-monospace, monospace' }}>
              {fresh}
            </code>
            <CopyBtn value={fresh} />
            <button onClick={() => setFresh(null)} className="p-1.5 rounded" style={{ color: S.textMute }}>
              <X size={13} />
            </button>
          </div>
        </div>
      )}

      {/* ── Keys ─────────────────────────────────────────────────────────────── */}
      <Card
        title="Clés API"
        icon={<KeyRound size={13} />}
        desc="Chaque clé donne un accès en lecture seule à ta bibliothèque, sans mot de passe ni session. Traite-la comme un mot de passe."
      >
        {!formOpen ? (
          <button
            onClick={() => setFormOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-[11px] font-semibold mb-3"
            style={{ background: S.accent, color: '#000' }}
          >
            <Plus size={12} />Générer une clé
          </button>
        ) : (
          <div className="rounded p-3 mb-3 flex flex-col gap-3"
            style={{ background: S.panelAlt, border: `1px solid ${S.border}` }}>
            <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
              <div>
                <div className="text-[10px] uppercase mb-1" style={{ color: S.textMute }}>Nom</div>
                <input
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="Export perso"
                  maxLength={60}
                  className="w-full outline-none rounded px-2 py-1.5 text-xs"
                  style={{ background: S.input, color: S.text, border: `1px solid ${S.border}` }}
                />
              </div>
              <div>
                <div className="text-[10px] uppercase mb-1" style={{ color: S.textMute }}>Portée</div>
                <select
                  value={scopeWs}
                  onChange={e => setScopeWs(e.target.value)}
                  className="w-full outline-none rounded px-2 py-1.5 text-xs"
                  style={{ background: S.input, color: S.text, border: `1px solid ${S.border}` }}
                >
                  <option value="">Tous mes workspaces</option>
                  {workspaces.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
              </div>
              <div>
                <div className="text-[10px] uppercase mb-1" style={{ color: S.textMute }}>Expiration</div>
                <select
                  value={expiry}
                  onChange={e => setExpiry(e.target.value)}
                  className="w-full outline-none rounded px-2 py-1.5 text-xs"
                  style={{ background: S.input, color: S.text, border: `1px solid ${S.border}` }}
                >
                  {EXPIRY_CHOICES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleCreate}
                disabled={creating}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded text-[11px] font-semibold"
                style={{ background: S.accent, color: '#000', opacity: creating ? 0.6 : 1 }}
              >
                {creating ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}Créer
              </button>
              <button
                onClick={() => setFormOpen(false)}
                className="px-3 py-1.5 rounded text-[11px]"
                style={{ background: S.input, color: S.textDim, border: `1px solid ${S.border}` }}
              >
                Annuler
              </button>
            </div>
          </div>
        )}

        {loading ? (
          <div className="flex items-center gap-2 py-4 text-[11px]" style={{ color: S.textMute }}>
            <Loader2 size={12} className="animate-spin" />Chargement…
          </div>
        ) : keys.length === 0 ? (
          <div className="py-4 text-[11px] text-center" style={{ color: S.textMute }}>
            Aucune clé pour l'instant.
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {keys.map(k => {
              const ws = workspaces.find(w => w.id === k.workspaceId)
              const expired = k.expired
              return (
                <div key={k.id} className="flex items-center gap-3 px-3 py-2 rounded"
                  style={{ background: S.panelAlt, border: `1px solid ${S.border}` }}>
                  <KeyRound size={13} style={{ color: expired ? S.red : S.textMute, flexShrink: 0 }} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs truncate" style={{ color: S.text }}>{k.name}</span>
                      <span className="text-[9px] px-1.5 py-0.5 rounded shrink-0"
                        style={{ background: S.input, color: S.textMute, border: `1px solid ${S.border}` }}>
                        {ws ? ws.name : 'Tous les workspaces'}
                      </span>
                      {expired && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded shrink-0"
                          style={{ background: 'rgba(231,76,60,0.12)', color: S.red }}>expirée</span>
                      )}
                    </div>
                    <div className="text-[10px] mt-0.5 flex flex-wrap gap-x-3" style={{ color: S.textMute }}>
                      <code style={{ fontFamily: 'ui-monospace, monospace' }}>{k.prefix}••••••••</code>
                      <span>créée le {fmtDate(k.createdAt)}</span>
                      <span>{fmtDateTime(k.lastUsedAt)}</span>
                      {k.expiresAt && <span>expire le {fmtDate(k.expiresAt)}</span>}
                    </div>
                  </div>
                  <button
                    onClick={() => handleDelete(k.id)}
                    disabled={deleting === k.id}
                    title="Supprimer définitivement"
                    className="p-1.5 rounded shrink-0"
                    style={{ color: S.red, background: 'transparent' }}
                  >
                    {deleting === k.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </Card>

      {/* ── Download ─────────────────────────────────────────────────────────── */}
      <Card
        title="Exporter la bibliothèque"
        icon={<Download size={13} />}
        desc="Colle une clé pour activer les téléchargements. Les URL générées contiennent la clé — elles fonctionnent aussi dans un navigateur, un script ou un cron."
      >
        <div className="flex items-center gap-2 mb-3">
          <div className="flex items-center gap-2 flex-1 rounded px-2 py-1.5"
            style={{ background: S.input, border: `1px solid ${idError ? 'rgba(231,76,60,0.4)' : S.border}` }}>
            <KeyRound size={12} style={{ color: S.textMute, flexShrink: 0 }} />
            <input
              type={showSecret ? 'text' : 'password'}
              value={secret}
              onChange={e => { setSecret(e.target.value); setIdentity(null); setIdError('') }}
              onBlur={() => checkKey(secret)}
              placeholder="vbk_…"
              className="flex-1 bg-transparent outline-none text-xs"
              style={{ color: S.text, fontFamily: 'ui-monospace, monospace' }}
            />
            <button onClick={() => setShowSecret(v => !v)} style={{ color: S.textMute }}>
              {showSecret ? <EyeOff size={12} /> : <Eye size={12} />}
            </button>
          </div>
          <button
            onClick={() => checkKey(secret)}
            disabled={checking || !secret.trim()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-[11px]"
            style={{ background: S.input, color: S.textDim, border: `1px solid ${S.border}`, opacity: secret.trim() ? 1 : 0.5 }}
          >
            {checking ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={11} />}Vérifier
          </button>
        </div>

        {idError && (
          <div className="text-[10px] mb-3" style={{ color: S.red }}>{idError}</div>
        )}

        {identity && (
          <div className="rounded px-3 py-2 mb-3 text-[10px]"
            style={{ background: 'rgba(74,222,128,0.07)', border: '1px solid rgba(74,222,128,0.25)', color: S.textDim }}>
            <span style={{ color: S.green }}>✓ Clé valide</span>
            {' · '}{identity.user.email}
            {' · '}{identity.workspaces.length} workspace{identity.workspaces.length > 1 ? 's' : ''}
            {' · '}{identity.workspaces.reduce((n, w) => n + w.trackCount, 0)} titres accessibles
          </div>
        )}

        <div className="grid gap-3 mb-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
          <div>
            <div className="text-[10px] uppercase mb-1" style={{ color: S.textMute }}>Workspace</div>
            <select
              value={expWs}
              onChange={e => setExpWsPick(e.target.value)}
              className="w-full outline-none rounded px-2 py-1.5 text-xs"
              style={{ background: S.input, color: S.text, border: `1px solid ${S.border}` }}
            >
              <option value="">Tous ceux accessibles</option>
              {(identity?.workspaces ?? workspaces).map(w => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </select>
          </div>
          <div>
            <div className="text-[10px] uppercase mb-1" style={{ color: S.textMute }}>Contenu de l'archive</div>
            <div className="flex items-center gap-3 h-[30px]">
              {([['Audio', withAudio, setWithAudio], ['Covers', withCovers, setWithCovers]] as const).map(([label, val, set]) => (
                <label key={label} className="flex items-center gap-1.5 text-[11px] cursor-pointer" style={{ color: val ? S.text : S.textMute }}>
                  <input type="checkbox" checked={val} onChange={e => set(e.target.checked)} style={{ accentColor: S.accent }} />
                  {label}
                </label>
              ))}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => download(apiKeyApi.libraryUrl(secret.trim(), 'json', opts))}
            disabled={!ready}
            className="flex items-center gap-1.5 px-3 py-2 rounded text-[11px]"
            style={btn(ready)}
          >
            <FileJson size={12} style={{ color: ready ? S.accent : undefined }} />Métadonnées JSON
          </button>
          <button
            onClick={() => download(apiKeyApi.libraryUrl(secret.trim(), 'csv', opts))}
            disabled={!ready}
            className="flex items-center gap-1.5 px-3 py-2 rounded text-[11px]"
            style={btn(ready)}
          >
            <FileSpreadsheet size={12} style={{ color: ready ? S.green : undefined }} />Tableur CSV
          </button>
          <button
            onClick={() => download(apiKeyApi.zipUrl(secret.trim(), opts))}
            disabled={!ready}
            className="flex items-center gap-1.5 px-3 py-2 rounded text-[11px]"
            style={btn(ready)}
          >
            <FileArchive size={12} style={{ color: ready ? S.accent : undefined }} />
            Archive ZIP{withAudio || withCovers ? ` (${[withAudio && 'audio', withCovers && 'covers'].filter(Boolean).join(' + ')})` : ' (métadonnées)'}
          </button>
        </div>

        <p className="text-[10px] mt-3 leading-relaxed" style={{ color: S.textMute }}>
          L'archive contient <code style={{ color: S.textDim }}>library.json</code>,{' '}
          <code style={{ color: S.textDim }}>library.csv</code>, un dossier{' '}
          <code style={{ color: S.textDim }}>audio/</code> et un dossier{' '}
          <code style={{ color: S.textDim }}>covers/</code>. Elle est générée à la volée : sur une grosse
          bibliothèque, laisse le téléchargement se poursuivre jusqu'au bout.
        </p>
      </Card>

      {/* ── API docs ─────────────────────────────────────────────────────────── */}
      <Card
        title="API"
        icon={<Terminal size={13} />}
        desc="Envoie la clé dans l'en-tête X-API-Key, en Authorization: Bearer, ou en paramètre ?api_key=."
      >
        <div className="flex flex-col gap-1 mb-3">
          {[
            ['GET  /api/export/v1/me',                        'Vérifie la clé et liste les workspaces accessibles'],
            ['GET  /api/export/v1/workspaces',                'Workspaces + nombre de titres'],
            ['GET  /api/export/v1/library',                   'Métadonnées (JSON ou ?format=csv), paginé'],
            ['GET  /api/export/v1/library.zip',               'Archive complète : métadonnées + audio + covers'],
            ['GET  /api/export/v1/tracks/:id',                'Un titre'],
            ['GET  /api/export/v1/tracks/:id/audio',          'Fichier audio (Range supporté)'],
            ['GET  /api/export/v1/tracks/:id/cover',          'Cover (proxy si elle est hébergée ailleurs)'],
          ].map(([route, desc]) => (
            <div key={route} className="flex flex-wrap items-baseline gap-x-3 px-2 py-1 rounded" style={{ background: S.panelAlt }}>
              <code className="text-[10px] whitespace-pre" style={{ color: S.accent, fontFamily: 'ui-monospace, monospace' }}>{route}</code>
              <span className="text-[10px]" style={{ color: S.textMute }}>{desc}</span>
            </div>
          ))}
        </div>

        <div className="text-[10px] uppercase mb-1.5" style={{ color: S.textMute }}>Exemples</div>
        <div className="flex flex-col gap-2">
          <Code>{`# Métadonnées de la bibliothèque
curl -H "X-API-Key: ${keyForDocs}" \\
  "${origin}/api/export/v1/library?limit=1000${wsQuery}"`}</Code>
          <Code>{`# Archive complète (audio + covers)
curl -H "X-API-Key: ${keyForDocs}" \\
  -o library.zip "${origin}/api/export/v1/library.zip${wsQuery ? '?' + wsQuery.slice(1) : ''}"`}</Code>
          <Code>{`# Télécharger chaque piste une par une (jq requis)
curl -s -H "X-API-Key: ${keyForDocs}" "${origin}/api/export/v1/library" \\
  | jq -r '.tracks[] | "\\(.id)\\t\\(.artist) - \\(.title)"' \\
  | while IFS=$'\\t' read -r id name; do
      curl -s -H "X-API-Key: ${keyForDocs}" \\
        -o "$name.mp3" "${origin}/api/export/v1/tracks/$id/audio"
    done`}</Code>
        </div>

        <div className="flex items-start gap-2 mt-3 px-3 py-2 rounded text-[10px] leading-relaxed"
          style={{ background: S.panelAlt, border: `1px solid ${S.border}`, color: S.textMute }}>
          <ShieldAlert size={12} style={{ color: S.accent, flexShrink: 0, marginTop: 1 }} />
          <span>
            Une clé vaut un accès en lecture à toute ta bibliothèque. Ne la commite pas dans un dépôt et
            évite le paramètre <code style={{ color: S.textDim }}>?api_key=</code> quand tu peux utiliser
            l'en-tête (les URL finissent dans les logs et l'historique du navigateur). Supprime-la
            immédiatement si elle fuite.
          </span>
        </div>
      </Card>
    </div>
  )
}
