import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { FaTiktok } from 'react-icons/fa6'
import { Loader2 } from 'lucide-react'

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? '/api'

export default function TiktokCallback() {
  const [params]   = useSearchParams()
  const navigate   = useNavigate()
  const [error, setError] = useState('')

  useEffect(() => {
    const code  = params.get('code')
    const state = params.get('state')
    const err   = params.get('error')

    if (err) {
      setError(params.get('error_description') ?? err)
      return
    }
    if (!code || !state) {
      setError('Paramètres de callback manquants.')
      return
    }

    fetch(`${API_BASE}/auth/tiktok/callback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, state }),
    })
      .then(r => r.json())
      .then((data: { ok?: boolean; error?: string }) => {
        if (data.error) throw new Error(data.error)
        navigate('/settings?section=comptes', { replace: true })
      })
      .catch((e: Error) => setError(e.message))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#111', gap: 16 }}>
      <FaTiktok size={32} style={{ color: '#69C9D0' }} />
      {error ? (
        <>
          <p style={{ color: '#e74c3c', fontSize: 13, maxWidth: 360, textAlign: 'center' }}>{error}</p>
          <button onClick={() => navigate('/settings?section=comptes', { replace: true })}
            style={{ color: '#f0a830', background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 12 }}>
            Retour aux paramètres
          </button>
        </>
      ) : (
        <>
          <Loader2 size={20} className="animate-spin" style={{ color: '#69C9D0' }} />
          <p style={{ color: '#888', fontSize: 12 }}>Connexion TikTok en cours…</p>
        </>
      )}
    </div>
  )
}
