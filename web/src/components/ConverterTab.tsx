import { useState, useEffect, useRef, useCallback } from 'react'
import {
  Upload, Download, Trash2, Loader2, CheckCircle2, XCircle,
  ArrowRight, RefreshCw, FileAudio, FileVideo, FileImage,
} from 'lucide-react'
import { convertApi } from '../lib/api'
import type { ConversionJob } from '../lib/api'

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
  cyan:     '#67e8f9',
  purple:   '#a78bfa',
}

const AUDIO_FORMATS = ['mp3', 'wav', 'flac', 'ogg', 'm4a', 'aac']
const VIDEO_FORMATS = ['mp4', 'mov', 'avi', 'mkv', 'webm']
const IMAGE_FORMATS = ['png', 'jpg', 'webp', 'bmp']

function getCategory(ext: string): 'audio' | 'video' | 'image' | null {
  if (AUDIO_FORMATS.includes(ext)) return 'audio'
  if (VIDEO_FORMATS.includes(ext) || ext === 'gif') return 'video'
  if (IMAGE_FORMATS.includes(ext)) return 'image'
  return null
}

interface FormatGroup { label: string; color: string; icon: React.ReactNode; formats: string[] }

function getOutputGroups(inputExt: string): FormatGroup[] {
  const cat = getCategory(inputExt)
  if (!cat) return []
  if (cat === 'audio') return [
    { label: 'Audio', color: S.accent, icon: <FileAudio size={10} />, formats: AUDIO_FORMATS.filter(f => f !== inputExt) },
  ]
  if (cat === 'video') return [
    { label: 'Audio', color: S.accent,  icon: <FileAudio size={10} />, formats: AUDIO_FORMATS },
    { label: 'Vidéo', color: S.purple,  icon: <FileVideo size={10} />, formats: VIDEO_FORMATS.filter(f => f !== inputExt) },
    { label: 'Anim',  color: S.cyan,    icon: <FileImage size={10} />, formats: ['gif'] },
  ]
  if (cat === 'image') return [
    { label: 'Image', color: S.green, icon: <FileImage size={10} />, formats: IMAGE_FORMATS.filter(f => f !== inputExt) },
  ]
  return []
}

const ACCEPT = [
  ...AUDIO_FORMATS, ...VIDEO_FORMATS, ...IMAGE_FORMATS, 'gif'
].map(f => `.${f}`).join(',')

function fmtSize(bytes?: number | null) {
  if (!bytes) return ''
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString('fr', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  })
}

interface Props { workspaceId: string }

export default function ConverterTab({ workspaceId }: Props) {
  const [file,           setFile]           = useState<File | null>(null)
  const [outputFormat,   setOutputFormat]   = useState('')
  const [converting,     setConverting]     = useState(false)
  const [dragOver,       setDragOver]       = useState(false)
  const [jobs,           setJobs]           = useState<ConversionJob[]>([])
  const [loadingHistory, setLoadingHistory] = useState(true)
  const fileRef  = useRef<HTMLInputElement>(null)
  const pollRef  = useRef<ReturnType<typeof setInterval> | null>(null)

  const loadHistory = useCallback(async () => {
    try {
      const { jobs: list } = await convertApi.history(workspaceId)
      setJobs(list)
    } catch {}
    finally { setLoadingHistory(false) }
  }, [workspaceId])

  useEffect(() => { loadHistory() }, [loadHistory])

  // Poll while any job is processing
  useEffect(() => {
    const busy = jobs.some(j => j.status === 'processing')
    if (busy && !pollRef.current) {
      pollRef.current = setInterval(loadHistory, 2000)
    } else if (!busy && pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
    return () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null } }
  }, [jobs, loadHistory])

  const inputExt     = file ? (file.name.split('.').pop()?.toLowerCase() ?? '') : ''
  const outputGroups = file ? getOutputGroups(inputExt) : []
  const catIcon      = inputExt ? (
    getCategory(inputExt) === 'audio' ? <FileAudio size={14} style={{ color: S.accent }} />
    : getCategory(inputExt) === 'video' ? <FileVideo size={14} style={{ color: S.purple }} />
    : <FileImage size={14} style={{ color: S.green }} />
  ) : null

  const pickFile = (f: File) => { setFile(f); setOutputFormat('') }

  const handleConvert = async () => {
    if (!file || !outputFormat || converting) return
    setConverting(true)
    try {
      const { job } = await convertApi.convert(workspaceId, file, outputFormat)
      setJobs(prev => [job, ...prev])
      setFile(null)
      setOutputFormat('')
    } catch { /* error visible in history */ }
    finally { setConverting(false) }
  }

  const handleDelete = async (jobId: string) => {
    try {
      await convertApi.delete(workspaceId, jobId)
      setJobs(prev => prev.filter(j => j.id !== jobId))
    } catch {}
  }

  return (
    <div className="flex flex-col gap-4 p-4 overflow-y-auto h-full" style={{ background: S.bg }}>

      {/* ── Drop zone ── */}
      <div
        onDragOver={e => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) pickFile(f) }}
        onClick={() => !file && fileRef.current?.click()}
        className="rounded-xl transition-all"
        style={{
          border: `2px dashed ${dragOver ? S.accent : file ? S.borderHi : S.border}`,
          background: dragOver ? `${S.accent}08` : file ? S.panel : S.panelAlt,
          padding: file ? '20px 20px' : '36px 20px',
          cursor: file ? 'default' : 'pointer',
        }}
      >
        {!file ? (
          <div className="flex flex-col items-center gap-2">
            <Upload size={26} style={{ color: dragOver ? S.accent : S.textMute }} />
            <p className="text-xs font-medium" style={{ color: S.textDim }}>
              Glissez un fichier ou cliquez pour choisir
            </p>
            <p className="text-[10px]" style={{ color: S.textMute }}>
              Audio (MP3, WAV, FLAC, OGG, M4A, AAC) · Vidéo (MP4, MOV, AVI, MKV, WEBM) · Image (PNG, JPG, WEBP, BMP, GIF) — max 500 MB
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {/* Selected file info */}
            <div className="flex items-center gap-3">
              {catIcon}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate" style={{ color: S.text }}>{file.name}</p>
                <p className="text-[10px]" style={{ color: S.textMute }}>{fmtSize(file.size)} · {inputExt.toUpperCase()}</p>
              </div>
              <button onClick={() => { setFile(null); setOutputFormat('') }}
                className="shrink-0 p-1 rounded hover:brightness-150" style={{ color: S.textMute }}>
                <XCircle size={16} />
              </button>
            </div>

            {/* Format groups */}
            {outputGroups.length > 0 && (
              <div className="flex flex-col gap-2 pt-1 border-t" style={{ borderColor: S.border }}>
                <div className="flex items-center gap-1.5">
                  <ArrowRight size={10} style={{ color: S.textMute }} />
                  <span className="text-[10px] uppercase tracking-wider" style={{ color: S.textMute }}>
                    Format de sortie
                  </span>
                </div>
                {outputGroups.map(group => (
                  <div key={group.label} className="flex items-center gap-2 flex-wrap">
                    <span className="flex items-center gap-1 text-[9px] uppercase w-12 shrink-0 justify-end"
                      style={{ color: group.color, opacity: 0.7 }}>
                      {group.icon}{group.label}
                    </span>
                    {group.formats.map(fmt => (
                      <button key={fmt} type="button"
                        onClick={() => setOutputFormat(fmt)}
                        className="px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase transition-all"
                        style={{
                          background: outputFormat === fmt ? `${group.color}25` : S.input,
                          color:      outputFormat === fmt ? group.color : S.textMute,
                          border:     `1px solid ${outputFormat === fmt ? group.color + '60' : S.border}`,
                        }}
                      >{fmt}</button>
                    ))}
                  </div>
                ))}
              </div>
            )}

            {/* Convert button */}
            <button
              disabled={!outputFormat || converting}
              onClick={handleConvert}
              className="flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-semibold disabled:opacity-40 transition-all mt-1"
              style={{
                background: outputFormat ? S.accent : S.border,
                color: outputFormat ? '#000' : S.textMute,
              }}
            >
              {converting
                ? <><Loader2 size={13} className="animate-spin" />Conversion en cours…</>
                : outputFormat
                ? <><ArrowRight size={13} />Convertir en {outputFormat.toUpperCase()}</>
                : <>Choisir un format de sortie</>}
            </button>
          </div>
        )}
      </div>

      <input ref={fileRef} type="file" accept={ACCEPT} className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) pickFile(f); e.target.value = '' }} />

      {/* ── History ── */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2 justify-between">
          <span className="text-[10px] uppercase tracking-widest" style={{ color: S.textMute }}>
            Historique
          </span>
          {jobs.some(j => j.status === 'processing') && (
            <span className="flex items-center gap-1 text-[10px]" style={{ color: S.cyan }}>
              <RefreshCw size={9} className="animate-spin" />en cours
            </span>
          )}
        </div>

        {loadingHistory ? (
          <div className="flex items-center justify-center gap-2 py-8" style={{ color: S.textMute }}>
            <Loader2 size={14} className="animate-spin" />
            <span className="text-xs">Chargement…</span>
          </div>
        ) : jobs.length === 0 ? (
          <div className="flex flex-col items-center py-8 gap-1" style={{ color: S.textMute }}>
            <p className="text-xs">Aucune conversion pour l'instant</p>
            <p className="text-[10px]" style={{ color: S.textFade }}>Vos conversions apparaîtront ici</p>
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {jobs.map(job => (
              <div key={job.id}
                className="flex items-center gap-3 px-3 py-2.5 rounded-lg"
                style={{ background: S.panel, border: `1px solid ${S.border}` }}
              >
                {/* Status */}
                <div className="shrink-0 w-4 flex justify-center">
                  {job.status === 'processing' && <Loader2 size={14} className="animate-spin" style={{ color: S.cyan }} />}
                  {job.status === 'done'        && <CheckCircle2 size={14} style={{ color: S.green }} />}
                  {job.status === 'error'       && <XCircle size={14} style={{ color: S.red }} />}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-xs font-medium truncate" style={{ color: S.text, maxWidth: 200 }}>
                      {job.inputName}
                    </span>
                    <span className="text-[10px] font-mono" style={{ color: S.textMute }}>→</span>
                    <span className="text-[9px] px-1.5 py-0.5 rounded font-mono font-bold uppercase"
                      style={{ background: `${S.accent}15`, color: S.accent, border: `1px solid ${S.accent}30` }}>
                      {job.outputFormat}
                    </span>
                    {job.fileSize != null && (
                      <span className="text-[9px] font-mono" style={{ color: S.textFade }}>
                        {fmtSize(job.fileSize)}
                      </span>
                    )}
                  </div>
                  {job.status === 'error' && job.errorMsg && (
                    <p className="text-[9px] mt-0.5 line-clamp-1" style={{ color: S.red, opacity: 0.8 }}>
                      {job.errorMsg}
                    </p>
                  )}
                  {job.status === 'processing' && (
                    <p className="text-[9px] mt-0.5" style={{ color: S.cyan }}>Conversion en cours…</p>
                  )}
                  <p className="text-[9px] mt-0.5" style={{ color: S.textFade }}>{fmtDate(job.createdAt)}</p>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-0.5 shrink-0">
                  {job.status === 'done' && (
                    <a href={convertApi.downloadUrl(workspaceId, job.id)} download
                      className="p-1.5 rounded hover:brightness-150 flex items-center"
                      style={{ color: S.green }} title="Télécharger">
                      <Download size={13} />
                    </a>
                  )}
                  <button onClick={() => handleDelete(job.id)}
                    className="p-1.5 rounded hover:brightness-150" style={{ color: S.textFade }} title="Supprimer">
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
