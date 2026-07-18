/**
 * Toast notification — slides in from the bottom-right for ~4 seconds.
 * Triggered by the `latest` value from notificationsStore.
 */
import { useEffect, useState } from 'react'
import { Music2, Film, Send, AlertCircle, CheckCircle2, Loader2, X } from 'lucide-react'
import type { Notification } from '../store/notificationsStore'

const TYPE_META: Record<string, { icon: React.ElementType; color: string }> = {
  'track:added':      { icon: Music2,        color: '#f0a830' },
  'track:error':      { icon: AlertCircle,   color: '#e74c3c' },
  'montage:started':  { icon: Loader2,       color: '#67e8f9' },
  'montage:done':     { icon: CheckCircle2,  color: '#4ade80' },
  'montage:failed':   { icon: AlertCircle,   color: '#e74c3c' },
  'post:sent':        { icon: Send,          color: '#4ade80' },
  'post:failed':      { icon: AlertCircle,   color: '#e74c3c' },
}

function getTypeMeta(type: string) {
  return TYPE_META[type] ?? { icon: Film, color: '#f0a830' }
}

interface Props {
  notif: Notification
  onNavigate: (link: string) => void
}

export default function NotifToast({ notif, onNavigate }: Props) {
  const [visible, setVisible] = useState(false)
  const [leaving, setLeaving] = useState(false)

  useEffect(() => {
    // Trigger enter animation
    const t1 = setTimeout(() => setVisible(true), 10)
    // Start leave after 3.5s
    const t2 = setTimeout(() => setLeaving(true), 3500)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [notif.id])

  const { icon: Icon, color } = getTypeMeta(notif.type)

  const handleClick = () => {
    if (notif.link) onNavigate(notif.link)
  }

  return (
    <div
      onClick={handleClick}
      style={{
        position: 'fixed',
        bottom: 72,   // above GlobalPlayer
        right: 16,
        zIndex: 9999,
        width: 300,
        background: '#1a1a1a',
        border: `1px solid ${color}40`,
        borderLeft: `3px solid ${color}`,
        borderRadius: 8,
        boxShadow: '0 8px 32px rgba(0,0,0,0.7)',
        padding: '10px 12px',
        display: 'flex',
        gap: 10,
        alignItems: 'flex-start',
        cursor: notif.link ? 'pointer' : 'default',
        transition: 'opacity 0.3s ease, transform 0.3s ease',
        opacity: visible && !leaving ? 1 : 0,
        transform: visible && !leaving ? 'translateY(0)' : 'translateY(16px)',
      }}
    >
      <Icon
        size={16}
        style={{
          color,
          flexShrink: 0,
          marginTop: 1,
          animation: notif.type === 'montage:started' ? 'spin 1s linear infinite' : undefined,
        }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: 12, fontWeight: 600, color: '#ddd', margin: 0, lineHeight: 1.4 }}>
          {notif.title}
        </p>
        <p style={{ fontSize: 11, color: '#888', margin: '2px 0 0', lineHeight: 1.4, wordBreak: 'break-word' }}>
          {notif.body}
        </p>
      </div>
      <button
        onClick={e => { e.stopPropagation(); setLeaving(true) }}
        style={{ flexShrink: 0, background: 'none', border: 'none', cursor: 'pointer', color: '#555', padding: 0, marginTop: 1 }}
      >
        <X size={12} />
      </button>
    </div>
  )
}
