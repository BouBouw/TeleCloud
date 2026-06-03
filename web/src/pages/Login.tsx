import { useState } from 'react'
import { Volume2, Eye, EyeOff, Loader2 } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'

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
}

const inputCls = "w-full outline-none rounded-md px-3 py-2.5 text-sm"
const inputSty: React.CSSProperties = {
  background: S.input, color: S.text, border: `1px solid ${S.border}`,
}

export default function Login() {
  const navigate = useNavigate()
  const { login, register } = useAuth()
  const [showPw,    setShowPw]    = useState(false)
  const [email,     setEmail]     = useState('')
  const [password,  setPassword]  = useState('')
  const [name,      setName]      = useState('')
  const [mode,      setMode]      = useState<'login' | 'register'>('login')
  const [loading,   setLoading]   = useState(false)
  const [error,     setError]     = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      if (mode === 'login') {
        await login(email, password)
        navigate('/dashboard')
      } else {
        await register(email, password, name || email.split('@')[0])
        navigate('/onboarding')
      }
    } catch (err) {
      setError(String(err).replace('Error: ', ''))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4"
      style={{ background: `radial-gradient(ellipse at 50% 20%, rgba(240,168,48,0.07) 0%, ${S.bg} 60%)` }}
    >
      <div className="w-full max-w-sm fade-in">

        {/* Logo */}
        <div className="flex items-center justify-center gap-3 mb-8">
          <div
            className="flex items-center justify-center rounded"
            style={{ width: 40, height: 40, background: S.panelAlt, border: `1px solid ${S.border}` }}
          >
            <Volume2 size={18} style={{ color: S.accent }} />
          </div>
          <span className="text-xl font-bold tracking-tight" style={{ color: S.text }}>
            Sound<span style={{ color: S.accent }}>Sync</span>
          </span>
        </div>

        {/* Card */}
        <div style={{ background: S.panel, border: `1px solid ${S.borderHi}`, borderRadius: 10, padding: 28 }}>
          <h2 className="text-base font-semibold mb-1" style={{ color: S.text }}>
            {mode === 'login' ? 'Connexion' : 'Créer un compte'}
          </h2>
          <p className="text-xs mb-6" style={{ color: S.textMute }}>
            {mode === 'login' ? 'Accédez à votre workspace' : 'Commencez à diffuser votre musique'}
          </p>

          {error && (
            <div
              className="mb-4 px-3 py-2.5 rounded text-xs"
              style={{ background: 'rgba(231,76,60,0.1)', border: `1px solid rgba(231,76,60,0.25)`, color: S.red }}
            >
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            {mode === 'register' && (
              <div>
                <div className="text-[10px] uppercase tracking-wide mb-1.5" style={{ color: S.textMute }}>Nom</div>
                <input
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="Votre nom"
                  className={inputCls}
                  style={inputSty}
                  onFocus={e => (e.target.style.borderColor = S.borderHi)}
                  onBlur={e => (e.target.style.borderColor = S.border)}
                />
              </div>
            )}

            <div>
              <div className="text-[10px] uppercase tracking-wide mb-1.5" style={{ color: S.textMute }}>Email</div>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="vous@vibot.io"
                className={inputCls}
                style={inputSty}
                onFocus={e => (e.target.style.borderColor = S.borderHi)}
                onBlur={e => (e.target.style.borderColor = S.border)}
                required
              />
            </div>

            <div>
              <div className="text-[10px] uppercase tracking-wide mb-1.5" style={{ color: S.textMute }}>Mot de passe</div>
              <div className="relative">
                <input
                  type={showPw ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  minLength={8}
                  className={inputCls}
                  style={{ ...inputSty, paddingRight: 40 }}
                  onFocus={e => (e.target.style.borderColor = S.borderHi)}
                  onBlur={e => (e.target.style.borderColor = S.border)}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPw(s => !s)}
                  className="absolute right-3 top-1/2 -translate-y-1/2"
                  style={{ color: S.textMute, background: 'transparent', border: 'none', cursor: 'pointer' }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = S.textDim }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = S.textMute }}
                >
                  {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-md text-sm font-semibold disabled:opacity-60 transition-opacity hover:opacity-85 mt-1"
              style={{ background: S.accent, color: '#000', border: 'none', cursor: loading ? 'default' : 'pointer' }}
            >
              {loading && <Loader2 size={14} className="animate-spin" />}
              {mode === 'login' ? 'Se connecter' : 'Créer le compte'}
            </button>
          </form>

          <p className="text-center text-[11px] mt-5" style={{ color: S.textMute }}>
            {mode === 'login' ? "Pas encore de compte ? " : 'Déjà inscrit ? '}
            <button
              onClick={() => { setMode(m => m === 'login' ? 'register' : 'login'); setError('') }}
              className="font-medium hover:brightness-125"
              style={{ color: S.accent, background: 'transparent', border: 'none', cursor: 'pointer' }}
            >
              {mode === 'login' ? "S'inscrire" : 'Se connecter'}
            </button>
          </p>
        </div>
      </div>
    </div>
  )
}
